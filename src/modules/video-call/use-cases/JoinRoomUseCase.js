import { getLateJoinGraceMinutes } from "../../../infrastructure/utils/timeUtils.js";
import {
  MAX_EXTENSION_MINUTES,
  WRAP_UP_COUNTDOWN_SECONDS,
  DEFAULT_BASE_DURATION_MINUTES,
} from '../../../config/videoCallConfig.js';

// In-memory store to keep track of sessionStartedAt for each room/appointment.
// Since it's in-memory, if the server restarts, ongoing calls will lose their timer sync.
export const roomStartTimes = new Map();

// In-memory store to track active participants per room: roomId -> Map<userId, socketId>
export const roomActiveParticipants = new Map();

// In-memory store to track active timers per room: roomId -> { wrapUpTimeout, endCallTimeout, hardLimitTimeout }
export const activeTimers = new Map();

// ──────────────────────────────────────────────────────────────────────────────
// Room State: Authoritative flags for each room's timer lifecycle.
// Used by ExtendRoomUseCase and JoinWaitingRoomUseCase for coordinated
// timer management and race condition handling.
//
// Structure per room: {
//   wrapUpTriggered: boolean,      — Once true, wrap-up is IRREVERSIBLE
//   extensionDeadlineMs: number,   — Absolute deadline for the extension
//   nextPatientWaitingSlotMs: number — Start time of the constraining next slot
// }
// ──────────────────────────────────────────────────────────────────────────────
export const roomState = new Map();

// Waiting Room Participants: Maps waiting room keys to user presence.
// Key format: `waiting_${appointmentId}` -> Map<userId, socketId>
// Written synchronously by JoinWaitingRoomUseCase to solve the race condition
// where extend_call and join_waiting_room arrive at the same millisecond.
export const waitingRoomParticipants = new Map();

export function clearRoomTimers(roomId) {
  const timers = activeTimers.get(roomId);
  if (timers) {
    if (timers.wrapUpTimeout) clearTimeout(timers.wrapUpTimeout);
    if (timers.endCallTimeout) clearTimeout(timers.endCallTimeout);
    if (timers.hardLimitTimeout) clearTimeout(timers.hardLimitTimeout);
    activeTimers.delete(roomId);
  }
}

export class JoinRoomUseCase {
  constructor(signalingGateway, appointmentRepository) {
    this.signalingGateway = signalingGateway;
    this.appointmentRepository = appointmentRepository;
  }
 
  async execute(appointmentId, userId, role) {
    if (!appointmentId) return;
    
    const roomId = `video_${appointmentId}`;

    // --- MULTIPLE TABS / DUPLICATE SESSION VALIDATION ---
    if (userId) {
      const currentSocketId = this.signalingGateway.socket?.id;
      const participants = roomActiveParticipants.get(roomId);
      if (participants && participants.has(userId)) {
        const existingSocketId = participants.get(userId);
        if (existingSocketId && existingSocketId !== currentSocketId) {
          const existingSocket = this.signalingGateway.getSocket(existingSocketId);
          if (existingSocket && existingSocket.connected) {
            console.warn(`[JoinRoomUseCase] User ${userId} attempted to join room ${roomId} from duplicate tab (${currentSocketId}) while already active (${existingSocketId}).`);
            this.signalingGateway.emitToSocket(currentSocketId, "join_rejected", {
              reason: "ALREADY_IN_ROOM",
              code: "MULTIPLE_TABS_DETECTED",
              message: "You are already active in this consultation room in another browser tab or device."
            });
            return; // Block duplicate tab join
          } else {
            // Previous socket connection is dead/stale, clean it up
            participants.delete(userId);
          }
        }
      }
    }

    // --- BACKEND VALIDATION ---
    if (this.appointmentRepository) {
      try {
        const appointment = await this.appointmentRepository.findById(appointmentId);
        if (appointment) {
          // Block in-person / offline appointments from joining video call
          const consultType = (appointment.consultationType || '').toLowerCase();
          if (consultType === 'offline' || consultType === 'physical') {
            const errMsg = { message: "This is an in-person consultation and does not support video calls." };
            if (this.signalingGateway.socket?.id) {
              this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
            }
            if (userId) {
              this.signalingGateway.emitToUser(userId, "call_error", errMsg);
            }
            return; // Block join
          }

          if (['completed', 'no-show', 'cancelled', 'cancelled-by-doctor', 'disputed', 'refunded'].includes(appointment.status)) {
            // Emit error directly to the socket trying to join
            if (this.signalingGateway.socket?.id) {
              this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", { message: "This consultation has already ended." });
            }
            if (userId) {
              this.signalingGateway.emitToUser(userId, "call_error", { message: "This consultation has already ended." });
            }
            return; // Block join
          }

          // Bug 9: Doctor busy lock
          if (userId && role?.toLowerCase() === 'patient') {
            for (const [rId, participants] of roomActiveParticipants.entries()) {
              if (rId !== roomId && participants.has(appointment.doctorId.toString())) {
                const errMsg = { message: "Your doctor is currently completing another consultation. Please wait." };
                if (this.signalingGateway.socket?.id) {
                  this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
                }
                return;
              }
            }
          }

          const currentTime = new Date();
          const currentMs = currentTime.getTime();
          
          let scheduledStartMs = 0;
          const [timeStr, modifier] = (appointment.appointmentTime || "").trim().split(/\s+/);
          
          if (timeStr) {
            const scheduledStartDate = new Date(appointment.appointmentDate);
            let [hours, minutes] = timeStr.split(":").map(Number);
            if (modifier?.toUpperCase() === "PM" && hours < 12) hours += 12;
            if (modifier?.toUpperCase() === "AM" && hours === 12) hours = 0;
            scheduledStartDate.setHours(hours, minutes, 0, 0);
            
            scheduledStartMs = scheduledStartDate.getTime();
            
            // Check if they are joining for the very first time
            const normalizedRole = role ? role.toLowerCase() : '';
            const hasJoinedBefore = normalizedRole === 'doctor' ? !!appointment.doctorJoinedAt : !!appointment.patientJoinedAt;

            // Block early join if trying to join more than 15 minutes before scheduled time
            if (currentMs < scheduledStartMs - 15 * 60000) {
              const errMsg = { message: "You can only join the consultation up to 15 minutes before the scheduled time." };
              if (this.signalingGateway.socket?.id) this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
              if (userId) this.signalingGateway.emitToUser(userId, "call_error", errMsg);
              return; // Block join
            }

            // Determine proportional late entry cutoff time
            let lateJoinCutoffMs;
            let cutoffMinsForMessage = 5;
            if (appointment.lateJoinCutoffAt) {
                lateJoinCutoffMs = appointment.lateJoinCutoffAt.getTime();
                cutoffMinsForMessage = Math.max(1, Math.round((lateJoinCutoffMs - scheduledStartMs) / 60000));
            } else {
                const slotDurationMins = (appointment.scheduledStartAt && appointment.scheduledEndAt)
                  ? Math.round((new Date(appointment.scheduledEndAt) - new Date(appointment.scheduledStartAt)) / 60000)
                  : 15;
                cutoffMinsForMessage = getLateJoinGraceMinutes(slotDurationMins);
                lateJoinCutoffMs = scheduledStartMs + cutoffMinsForMessage * 60000;
            }

            // Block initial join if past the late entry cutoff
            if (!hasJoinedBefore && currentMs >= lateJoinCutoffMs) {
              const errMsg = { message: `The late entry grace period (${cutoffMinsForMessage} mins) has expired for this consultation.` };
              if (this.signalingGateway.socket?.id) this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
              if (userId) this.signalingGateway.emitToUser(userId, "call_error", errMsg);
              return; // Block join
            }
            
            // Enforce consultation duration window (from scheduledEndAt or default duration)
            const maxSessionEndMs = appointment.scheduledEndAt 
              ? new Date(appointment.scheduledEndAt).getTime() 
              : scheduledStartMs + 60 * 60000;

            if (currentMs >= maxSessionEndMs) {
              const errMsg = { message: "The consultation window has expired." };
              if (this.signalingGateway.socket?.id) this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
              if (userId) this.signalingGateway.emitToUser(userId, "call_error", errMsg);
              return; // Block join
            }
          }

          let hasUpdates = false;
          if (scheduledStartMs > 0) {
            const getJoinStatus = (joinMs, startMs) => {
                const diffMins = (joinMs - startMs) / 60000;
                if (diffMins < -3) return "EARLY";
                if (diffMins > 4) return "LATE";
                return "ON_TIME";
            };
            
            const normalizedRole = role ? role.toLowerCase() : '';
            if (normalizedRole === 'doctor' && !appointment.doctorJoinedAt) {
                appointment.doctorJoinedAt = currentTime;
                appointment.doctorJoinStatus = getJoinStatus(currentMs, scheduledStartMs);
                hasUpdates = true;
            } else if (normalizedRole === 'patient' && !appointment.patientJoinedAt) {
                appointment.patientJoinedAt = currentTime;
                appointment.patientJoinStatus = getJoinStatus(currentMs, scheduledStartMs);
                hasUpdates = true;
            }
          }
          
          if (hasUpdates) {
             await appointment.save();
          }

        }
      } catch (err) {
        console.error("[JoinRoomUseCase] Error validating appointment status:", err);
      }
    }
    // Register user in roomActiveParticipants
    if (userId) {
      if (!roomActiveParticipants.has(roomId)) {
        roomActiveParticipants.set(roomId, new Map());
      }
      roomActiveParticipants.get(roomId).set(userId, this.signalingGateway.socket.id);
    }

    const numClients = this.signalingGateway.getRoomSize(roomId);

    this.signalingGateway.joinRoom(roomId);

    // If patient joins first, notify the doctor
    const normalizedRole = role ? role.toLowerCase() : '';
    if (numClients === 0 && normalizedRole === 'patient') {
      try {
        if (this.appointmentRepository) {
          const appointment = await this.appointmentRepository.findById(appointmentId);
          if (appointment && appointment.doctorId) {
            const mongoose = await import('mongoose');
            const SharedUser = mongoose.model('SharedUser');
            const Appointment = mongoose.model('Appointment');

            const [doctorUser, patientUser] = await Promise.all([
              SharedUser.findOne({ profileId: appointment.doctorId, role: 'doctor' }),
              SharedUser.findById(userId).populate('profileId')
            ]);

            if (doctorUser) {
              const pProfile = patientUser?.profileId || {};
              const patientName = `${pProfile.firstName || ''} ${pProfile.lastName || ''}`.trim() || patientUser?.googleName || "A patient";

              // Standard "patient arrived" notification for the current room
              this.signalingGateway.emitToUser(
                doctorUser._id.toString(),
                "patient-arrived",
                { 
                  appointmentId, 
                  patientId: userId, 
                  patientName, 
                  patientType: appointment.patientType,
                  appointmentTime: appointment.appointmentTime,
                  appointmentDate: appointment.appointmentDate
                }
              );

              // ── Backend-Driven Exact Slot Time Auto-Cut (The Golden Rule) ──
              // Find if the doctor is currently in ANOTHER active consultation room
              let doctorActiveRoomId = null;
              for (const [rId, participants] of roomActiveParticipants.entries()) {
                if (rId !== roomId && participants.has(doctorUser._id.toString())) {
                  doctorActiveRoomId = rId;
                  break;
                }
              }

              if (doctorActiveRoomId) {
                let scheduledStartMs = 0;
                const [timeStr, modifier] = (appointment.appointmentTime || "").trim().split(/\s+/);
                if (timeStr) {
                  const scheduledStartDate = new Date(appointment.appointmentDate);
                  let [hours, minutes] = timeStr.split(":").map(Number);
                  if (modifier?.toUpperCase() === "PM" && hours < 12) hours += 12;
                  if (modifier?.toUpperCase() === "AM" && hours === 12) hours = 0;
                  scheduledStartDate.setHours(hours, minutes, 0, 0);
                  scheduledStartMs = scheduledStartDate.getTime();
                }

                console.log(`[JoinRoomUseCase] Doctor ${doctorUser._id} is in active room ${doctorActiveRoomId}. Scheduling exact time auto-cut based on new patient's slot: ${new Date(scheduledStartMs).toISOString()}`);
                const nowMs = Date.now();
                
                let timers = activeTimers.get(doctorActiveRoomId);
                if (!timers) {
                   timers = {};
                   activeTimers.set(doctorActiveRoomId, timers);
                }
                
                // Clear any existing WrapUp/EndCall timeouts so we don't duplicate
                if (timers.wrapUpTimeout) clearTimeout(timers.wrapUpTimeout);
                if (timers.endCallTimeout) clearTimeout(timers.endCallTimeout);

                const delayUntilNextSlot = Math.max(0, scheduledStartMs - nowMs);
                
                timers.wrapUpTimeout = setTimeout(() => {
                  console.log(`[JoinRoomUseCase] Exact slot time reached for next patient. Triggering 1-minute WrapUp in ${doctorActiveRoomId}.`);
                  this.signalingGateway.broadcastToRoom(doctorActiveRoomId, "server_wrap_up_warning", { remainingSeconds: 60 });
                  
                  timers.endCallTimeout = setTimeout(async () => {
                     console.log(`[JoinRoomUseCase] 1-minute WrapUp completed for room ${doctorActiveRoomId}. Auto-terminating.`);
                     this.signalingGateway.broadcastToRoom(doctorActiveRoomId, "force_end_call", { reason: "next_slot_started" });
                     const activeApptId = doctorActiveRoomId.replace('video_', '');
                     try {
                       const Appointment = mongoose.model('Appointment');
                       await Appointment.updateOne({ _id: activeApptId }, { status: 'completed' });
                     } catch(e) {}
                     clearRoomTimers(doctorActiveRoomId);
                  }, 60000);
                }, delayUntilNextSlot);
              }
              // ───────────────────────────────────────────────────────────────

              // ── Offline → Online Transition Detection ─────────────────────────────
              // If the current appointment is ONLINE, check whether the doctor
              // has a PREVIOUS offline appointment that is still 'scheduled'
              // (meaning they may still be with that patient in-person).
              if (['online', 'video'].includes(appointment.consultationType)) {
                try {
                  const nowMs = Date.now();
                  // Look for a previous offline appointment for the same doctor today
                  // that started within the last 90 minutes and is still scheduled
                  const today = new Date(appointment.appointmentDate);
                  const startOfDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0));
                  const endOfDay   = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999));

                  const prevOfflineAppointment = await Appointment.findOne({
                    doctorId: appointment.doctorId,
                    consultationType: { $in: ['offline', 'physical'] },
                    status: 'scheduled',
                    appointmentDate: { $gte: startOfDay, $lte: endOfDay },
                  }).sort({ appointmentTime: -1 });

                  if (prevOfflineAppointment) {
                    console.log(`[JoinRoomUseCase] Offline→Online transition detected. Alerting doctor ${doctorUser._id}.`);

                    // Alert the doctor that their online patient has arrived
                    this.signalingGateway.emitToUser(
                      doctorUser._id.toString(),
                      'next_patient_joining_online',
                      {
                        appointmentId,              // the NEW online appointment
                        prevAppointmentId: prevOfflineAppointment._id.toString(),
                        patientName,
                        minutesUntilHardCut: 1,
                      }
                    );

                    // ── 60-second doctorDelayed tracking ─────────────────────
                    // Removed unsafe setTimeout that caused memory leaks.
                    // This is now properly handled by an external cron job.
                    // ─────────────────────────────────────────────────────────
                  }
                } catch (transitionErr) {
                  console.error('[JoinRoomUseCase] Error in Offline→Online transition detection:', transitionErr);
                }
              }
              // ─────────────────────────────────────────────────────────────────
            }
          }
        } 
      } catch (err) {
        console.error("[JoinRoomUseCase] Error notifying doctor:", err);
      }
    }

    // If there is already someone in the room, notify them so they can initiate the WebRTC offer
    if (numClients > 0) {
      this.signalingGateway.emitToRoom(roomId, "peer_joined");

      try {
        if (this.appointmentRepository) {
          const appointment = await this.appointmentRepository.findById(appointmentId);
          if (appointment) {
            let sessionStartedAt = roomStartTimes.get(appointmentId);
            if (!sessionStartedAt) {
              if (appointment.sessionStartedAt) {
                // Restore from DB if the in-memory map was cleared
                sessionStartedAt = appointment.sessionStartedAt.toISOString();
                roomStartTimes.set(appointmentId, sessionStartedAt);
              } else {
                sessionStartedAt = new Date().toISOString();
                roomStartTimes.set(appointmentId, sessionStartedAt);
                
                // Persist sessionStartedAt to DB if this is the very first time the call begins
                try {
                  appointment.sessionStartedAt = new Date(sessionStartedAt);
                  appointment.participantsConnectedAt = appointment.sessionStartedAt;
                  appointment.roomId = roomId;

                  const [timeStr, modifier] = (appointment.appointmentTime || "").trim().split(/\s+/);
                  if (timeStr) {
                    const scheduledStart = new Date(appointment.appointmentDate);
                    let [hours, minutes] = timeStr.split(":").map(Number);
                    if (modifier?.toUpperCase() === "PM" && hours < 12) hours += 12;
                    if (modifier?.toUpperCase() === "AM" && hours === 12) hours = 0;
                    scheduledStart.setHours(hours, minutes, 0, 0);

                    const diffMins = (appointment.sessionStartedAt.getTime() - scheduledStart.getTime()) / 60000;
                    if (diffMins < -3) {
                      appointment.sessionStartStatus = "EARLY";
                    } else if (diffMins > 4) {
                      appointment.sessionStartStatus = "LATE";
                    } else {
                      appointment.sessionStartStatus = "ON_TIME";
                    }
                  }

                  await appointment.save();
                } catch (saveErr) {
                  console.error("[JoinRoomUseCase] Error saving sessionStartedAt to DB:", saveErr);
                }
              }
            }

            // Dynamically determine slot duration and scheduled boundaries from the appointment
            let scheduledStartDate;
            let scheduledEndTimeObj;
            let baseDurationMinutes = DEFAULT_BASE_DURATION_MINUTES; // default fallback from config

            if (appointment.scheduledStartAt && appointment.scheduledEndAt) {
              scheduledStartDate = new Date(appointment.scheduledStartAt);
              scheduledEndTimeObj = new Date(appointment.scheduledEndAt);
              const diffMins = Math.round((scheduledEndTimeObj.getTime() - scheduledStartDate.getTime()) / 60000);
              if (diffMins > 0) {
                baseDurationMinutes = diffMins;
              }
            } else {
              // Fallback for legacy appointments without explicit scheduledStartAt / scheduledEndAt
              const [timeStr, modifier] = (appointment.appointmentTime || "").split(" ");
              let [hours, minutes] = (timeStr || "").split(":");
              
              scheduledStartDate = new Date(appointment.appointmentDate);
              if (hours !== undefined && minutes !== undefined) {
                let h = parseInt(hours, 10);
                if (modifier === "PM" && h < 12) h += 12;
                if (modifier === "AM" && h === 12) h = 0;
                scheduledStartDate.setHours(h, parseInt(minutes, 10), 0, 0);
              } else {
                scheduledStartDate = new Date(sessionStartedAt);
              }

              scheduledEndTimeObj = new Date(scheduledStartDate);
              if (appointment.appointmentTime && appointment.appointmentTime.includes('-')) {
                const parts = appointment.appointmentTime.split('-');
                if (parts.length === 2) {
                  const [endTimeStr, endModifier] = parts[1].trim().split(" ");
                  let [endHours, endMinutes] = (endTimeStr || "").split(":");
                  if (endHours !== undefined && endMinutes !== undefined) {
                    let h = parseInt(endHours, 10);
                    if (endModifier === "PM" && h < 12) h += 12;
                    if (endModifier === "AM" && h === 12) h = 0;
                    scheduledEndTimeObj.setHours(h, parseInt(endMinutes, 10), 0, 0);
                    const rangeDiffMins = Math.round((scheduledEndTimeObj.getTime() - scheduledStartDate.getTime()) / 60000);
                    if (rangeDiffMins > 0) {
                      baseDurationMinutes = rangeDiffMins;
                    }
                  }
                }
              } else {
                scheduledEndTimeObj = new Date(scheduledStartDate.getTime() + baseDurationMinutes * 60000);
              }
            }

            const scheduledEndTime = scheduledEndTimeObj.toISOString();

            // Check if there is an overlapping next appointment (with type and arrival status)
            let isNextSlotBooked = false;
            let nextAppointmentType = null; // 'online' | 'offline' | null
            let nextSlotStatus = 'FREE'; // 'FREE' (Condition A) | 'PATIENT_LATE' (Condition B) | 'PATIENT_PRESENT'
            let nextAppointmentId = null;
            let nextSlotStartTimeMs = null;

            try {
              const mongoose = await import('mongoose');
              const Appointment = mongoose.model('Appointment');
              
              const overlappingAppointments = await Appointment.find({
                doctorId: appointment.doctorId,
                appointmentDate: appointment.appointmentDate,
                status: { $in: ['scheduled', 'locked'] },
                _id: { $ne: appointmentId }
              });
              
              const currentEnd = scheduledEndTimeObj.getTime();
              const maxExtensionEnd = currentEnd + MAX_EXTENSION_MINUTES * 60000;
              
              for (const app of overlappingAppointments) {
                const [appTimeStr, appModifier] = (app.appointmentTime || "").trim().split(/\s+/);
                if (appTimeStr) {
                    let [appHours, appMinutes] = appTimeStr.split(":");
                    let h = parseInt(appHours, 10);
                    const m = parseInt(appMinutes, 10) || 0;
                    if (appModifier) {
                        if (appModifier.toUpperCase() === "PM" && h < 12) h += 12;
                        if (appModifier.toUpperCase() === "AM" && h === 12) h = 0;
                    }
                    const appStart = new Date(appointment.appointmentDate);
                    appStart.setHours(h, m, 0, 0);
                    
                    const appStartTime = appStart.getTime();
                    // Next slot overlaps extension time
                    if (appStartTime < maxExtensionEnd && appStartTime >= currentEnd - 5 * 60000) {
                        isNextSlotBooked = true;
                        nextAppointmentId = app._id ? app._id.toString() : null;
                        nextSlotStartTimeMs = appStartTime;
                        // Resolve the consultation type for the frontend timer logic
                        nextAppointmentType = ['offline', 'physical'].includes(app.consultationType)
                          ? 'offline'
                          : 'online';
                        
                        if (app.patientJoinedAt) {
                          nextSlotStatus = 'PATIENT_PRESENT';
                        } else {
                          nextSlotStatus = 'PATIENT_LATE';
                        }
                        break;
                    }
                }
              }
            } catch (err) {
              console.error("[JoinRoomUseCase] Error checking next slot:", err);
            }

            // Calculate precise end times based on Session Start Status
            let sessionStatus = "ON_TIME";
            const sessionStartMs = new Date(sessionStartedAt).getTime();
            const scheduledStartMs = scheduledStartDate.getTime();
            const scheduledEndMs = scheduledEndTimeObj.getTime();
            const sessionDiffMins = (sessionStartMs - scheduledStartMs) / 60000;
            
            if (sessionDiffMins < -3) {
              sessionStatus = "EARLY";
            } else if (sessionDiffMins > 4) {
              sessionStatus = "LATE";
            }

            // Calculate precise end times based on Session Start Status
            let primaryEndTimeMs;
            let absoluteHardLimitMs;

            const standardDurationMs = baseDurationMinutes * 60000;
            const maxExtensionMs = MAX_EXTENSION_MINUTES * 60000; // configurable extension allowance

            if (sessionStatus === "EARLY") {
                primaryEndTimeMs = sessionStartMs + standardDurationMs;
                absoluteHardLimitMs = primaryEndTimeMs + maxExtensionMs;
            } else if (sessionStatus === "ON_TIME") {
                primaryEndTimeMs = scheduledEndMs;
                absoluteHardLimitMs = scheduledEndMs + maxExtensionMs;
            } else {
                // LATE start
                primaryEndTimeMs = Math.min(sessionStartMs + standardDurationMs, scheduledEndMs);
                absoluteHardLimitMs = primaryEndTimeMs + maxExtensionMs;
            }

            // Bug 3 & 4: Cap hard limit strictly based on next appointment
            try {
              const mongoose = await import('mongoose');
              const Appointment = mongoose.model('Appointment');
              const upcomingNext = await Appointment.find({
                doctorId: appointment.doctorId,
                appointmentDate: appointment.appointmentDate,
                status: { $in: ['scheduled', 'locked'] },
                _id: { $ne: appointmentId }
              });

              let earliestNextStartTimeMs = null;
              for (const app of upcomingNext) {
                const [appTimeStr, appModifier] = (app.appointmentTime || "").trim().split(/\s+/);
                if (appTimeStr) {
                    let [appHours, appMinutes] = appTimeStr.split(":");
                    let h = parseInt(appHours, 10);
                    const m = parseInt(appMinutes, 10) || 0;
                    if (appModifier) {
                        if (appModifier.toUpperCase() === "PM" && h < 12) h += 12;
                        if (appModifier.toUpperCase() === "AM" && h === 12) h = 0;
                    }
                    const nextStart = new Date(appointment.appointmentDate);
                    nextStart.setHours(h, m, 0, 0);
                    const nextStartTimeMs = nextStart.getTime();

                    if (nextStartTimeMs > primaryEndTimeMs) {
                      if (!earliestNextStartTimeMs || nextStartTimeMs < earliestNextStartTimeMs) {
                        earliestNextStartTimeMs = nextStartTimeMs;
                      }
                    }
                }
              }

              if (earliestNextStartTimeMs) {
                absoluteHardLimitMs = Math.max(primaryEndTimeMs, Math.min(absoluteHardLimitMs, earliestNextStartTimeMs));
              }
            } catch (err) {
               console.error("[JoinRoomUseCase] Error capping absoluteHardLimitMs:", err);
            }

            const primaryEndTime = new Date(primaryEndTimeMs).toISOString();
            const absoluteHardLimitTime = new Date(absoluteHardLimitMs).toISOString();

            // Broadcast timer details to all in the room
            this.signalingGateway.broadcastToRoom(roomId, "call_timer_started", {
              sessionStartedAt,
              scheduledEndTime,
              baseDurationMinutes,
              maxExtensionMinutes: MAX_EXTENSION_MINUTES, // configurable — sent to frontend for display
              wrapUpCountdownSeconds: WRAP_UP_COUNTDOWN_SECONDS,
              isNextSlotBooked,
              nextAppointmentType,     // 'online' | 'offline' | null
              nextSlotStatus,          // 'FREE' | 'PATIENT_LATE' | 'PATIENT_PRESENT'
              nextAppointmentId,
              nextSlotStartTime: nextSlotStartTimeMs ? new Date(nextSlotStartTimeMs).toISOString() : null,
              primaryEndTime,
              absoluteHardLimitTime,
              isAlreadyExtended: !!appointment.isExtended
            });
            // ─────────────────────────────────────────────────────────────
            // Backend-Driven Timers Setup
            // ─────────────────────────────────────────────────────────────
            clearRoomTimers(roomId);
            const timers = {};
            activeTimers.set(roomId, timers);

            const nowMs = Date.now();
            const startMs = new Date(sessionStartedAt).getTime();
            
            // 1. Strict Hard Limit Timeout (uses MAX_EXTENSION_MINUTES from config)
            // Absolute hard limit is calculated as sessionStartedAt + baseDurationMinutes + MAX_EXTENSION_MINUTES
            const strictAbsoluteLimitMs = startMs + (baseDurationMinutes + MAX_EXTENSION_MINUTES) * 60000;
            const delayUntilStrictHardLimit = Math.max(0, strictAbsoluteLimitMs - nowMs);
            
            timers.hardLimitTimeout = setTimeout(async () => {
              console.log(`[JoinRoomUseCase] Strict ${MAX_EXTENSION_MINUTES}-minute hard limit reached for room ${roomId}. Auto-terminating.`);
              this.signalingGateway.broadcastToRoom(roomId, "force_end_call", { reason: "max_extension_reached" });
              try {
                const mongoose = await import('mongoose');
                const Appointment = mongoose.model('Appointment');
                await Appointment.updateOne({ _id: appointmentId }, { status: 'completed' });
              } catch(e) {}
              clearRoomTimers(roomId);
            }, delayUntilStrictHardLimit);

            // 2. Next Patient Exact Time Auto-Cut (If they are ALREADY in the waiting room when this call starts)
            if (nextSlotStartTimeMs && nextSlotStatus === 'PATIENT_PRESENT') {
              const delayUntilNextSlot = Math.max(0, nextSlotStartTimeMs - nowMs);
              
              timers.wrapUpTimeout = setTimeout(() => {
                console.log(`[JoinRoomUseCase] Exact slot time reached for next patient. Triggering 1-minute WrapUp in ${roomId}.`);
                this.signalingGateway.broadcastToRoom(roomId, "server_wrap_up_warning", { remainingSeconds: 60 });
                
                timers.endCallTimeout = setTimeout(async () => {
                   console.log(`[JoinRoomUseCase] 1-minute WrapUp completed for room ${roomId}. Auto-terminating.`);
                   this.signalingGateway.broadcastToRoom(roomId, "force_end_call", { reason: "next_slot_started" });
                   try {
                     const mongoose = await import('mongoose');
                     const Appointment = mongoose.model('Appointment');
                     await Appointment.updateOne({ _id: appointmentId }, { status: 'completed' });
                   } catch(e) {}
                   clearRoomTimers(roomId);
                }, 60000);
              }, delayUntilNextSlot);
            }
            // ─────────────────────────────────────────────────────────────
          }
        }
      } catch (err) {
        console.error("[JoinRoomUseCase] Error setting up call timer:", err);
      }
    }
  }
}
