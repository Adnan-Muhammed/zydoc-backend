import {
  getLateJoinGraceMinutes,
  calculateConsultationTiming,
} from "../../../infrastructure/utils/timeUtils.js";
import {
  EARLY_JOIN_MINUTES,
  EARLY_START_MINUTES,
  MAX_EXTENSION_MINUTES,
  WRAP_UP_COUNTDOWN_SECONDS,
  DEFAULT_BASE_DURATION_MINUTES,
} from '../../../config/videoCallConfig.js';
 
// ── Role-specific early-join boundaries ─────────────────────────────────────
// Patient : can enter the waiting room from  scheduledStart - EARLY_JOIN_MINUTES  (10 min)
// Doctor  : can join the call room only from scheduledStart - EARLY_START_MINUTES (7 min)
// This ensures the doctor cannot enter before the early-start window that is
// already shown to the patient on the waiting screen.

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
    const normalizedRole = role ? role.toLowerCase() : '';

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

          if (['completed', 'no-show', 'cancelled', 'cancelled_by_doctor', 'disputed', 'refunded'].includes(appointment.status)) {
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
            const hasJoinedBefore = normalizedRole === 'doctor' ? !!appointment.doctorJoinedAt : !!appointment.patientJoinedAt;

            // ── Role-specific early-join boundary check ───────────────────
            // Doctor  → may only join from the early-start window (scheduledStart - EARLY_START_MINUTES)
            // Patient → may join from the broader waiting-room window (scheduledStart - EARLY_JOIN_MINUTES)
            if (normalizedRole === 'doctor') {
              const doctorEarlyStartMs = scheduledStartMs - EARLY_START_MINUTES * 60000;
              if (currentMs < doctorEarlyStartMs) {
                const earlyStartTime = new Date(doctorEarlyStartMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const errMsg = { message: `You can join this consultation from ${earlyStartTime} (${EARLY_START_MINUTES} minutes before the scheduled time).` };
                if (this.signalingGateway.socket?.id) this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
                if (userId) this.signalingGateway.emitToUser(userId, "call_error", errMsg);
                return; // Block doctor join before early-start window
              }
            } else {
              // Patient: blocked before EARLY_JOIN_MINUTES (10 min) window
              if (currentMs < scheduledStartMs - EARLY_JOIN_MINUTES * 60000) {
                const earlyJoinTime = new Date(scheduledStartMs - EARLY_JOIN_MINUTES * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const errMsg = { message: `The consultation room opens ${EARLY_JOIN_MINUTES} minutes before the scheduled time (at ${earlyJoinTime}).` };
                if (this.signalingGateway.socket?.id) this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
                if (userId) this.signalingGateway.emitToUser(userId, "call_error", errMsg);
                return; // Block patient join before early-join window
              }
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

            // ── Patient Join & Re-join Eligibility (Rule 4) ────────────────────
            // Case A: Active consultation re-join (doctor and patient already connected before)
            if (appointment.hasOverlapped && appointment.status !== 'completed') {
              const baseEndMs = appointment.scheduledEndAt
                ? new Date(appointment.scheduledEndAt).getTime()
                : (scheduledStartMs + 15 * 60000);
              
              if (currentMs > baseEndMs) {
                const errMsg = {
                  message: "The scheduled slot time for this consultation has ended. Re-joining is no longer possible."
                };
                if (this.signalingGateway.socket?.id) this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
                if (userId) this.signalingGateway.emitToUser(userId, "call_error", errMsg);
                return;
              }
            } else if (normalizedRole === 'patient') {
              // Case B: Initial waiting phase (doctor and patient have not yet met)
              // Strict cut-off: access is blocked past lateJoinCutoffAt
              if (currentMs >= lateJoinCutoffMs) {
                const errMsg = {
                  message: hasJoinedBefore
                    ? `The consultation window has closed (late-join cutoff: ${cutoffMinsForMessage} min after scheduled start). Re-joining is no longer possible.`
                    : `The late entry grace period (${cutoffMinsForMessage} mins) has expired for this consultation.`
                };
                if (this.signalingGateway.socket?.id) this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
                if (userId) this.signalingGateway.emitToUser(userId, "call_error", errMsg);
                return; // Block
              }
            }

            // ── Doctor Attendance Notice (Rule 1 & 3) ─────────────────────────
            // If the patient joins during their valid window but the doctor has
            // not joined yet, surface a notice with the 20-30s buffer explanation.
            if (normalizedRole === 'patient' && currentMs >= scheduledStartMs && !appointment.doctorJoinedAt) {
              console.warn(`[JoinRoomUseCase] Doctor ${appointment.doctorId} has not joined yet for appointment ${appointmentId}. Patient ${userId} is present.`);
              if (this.signalingGateway.socket?.id) {
                this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "doctor_absence_warning", {
                  appointmentId,
                  message: "The doctor has been notified. Doctors are allowed a 20–30s buffer time to join. If the doctor does not attend within the allowed time, a full refund will be automatically issued.",
                  lateJoinCutoffAt: appointment.lateJoinCutoffAt || new Date(lateJoinCutoffMs),
                });
              }
            }
          }

          let hasUpdates = false;
          if (scheduledStartMs > 0) {
            const getJoinStatus = (joinMs, startMs) => {
                const diff = joinMs - startMs;
                if (diff < -60000) return "EARLY";
                if (diff > 60000) return "LATE";
                return "ON_TIME";
            };
            
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

          // ── Track Entry in Array Structure (Rule 2.2) ───────────────────────
          if (!appointment.patientAttendanceLogs) appointment.patientAttendanceLogs = [];
          if (!appointment.doctorAttendanceLogs) appointment.doctorAttendanceLogs = [];

          if (normalizedRole === 'patient') {
            appointment.patientAttendanceLogs.push({
              joinedAt: currentTime,
              isValidWait: false,
            });
            hasUpdates = true;
          } else if (normalizedRole === 'doctor') {
            appointment.doctorAttendanceLogs.push({
              joinedAt: currentTime,
            });
            hasUpdates = true;
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

    // If patient joins and doctor is not in the room, notify the doctor with 20-30s buffer
    if (normalizedRole === 'patient') {
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

            const participants = roomActiveParticipants.get(roomId);
            const isDoctorInRoom = doctorUser && participants && participants.has(doctorUser._id.toString());

            if (doctorUser && !isDoctorInRoom) {
              const pProfile = patientUser?.profileId || {};
              const patientName = `${pProfile.firstName || ''} ${pProfile.lastName || ''}`.trim() || patientUser?.googleName || "A patient";

              // Real-time alert to doctor with 20-30s buffer
              this.signalingGateway.emitToUser(
                doctorUser._id.toString(),
                "patient-arrived",
                { 
                  appointmentId, 
                  patientId: userId, 
                  patientName, 
                  patientType: appointment.patientType,
                  appointmentTime: appointment.appointmentTime,
                  appointmentDate: appointment.appointmentDate,
                  bufferSeconds: 30,
                  message: `${patientName} has entered the consultation room. Please join within 30 seconds.`
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
                  console.log(`[JoinRoomUseCase] Exact slot time reached for next patient. Triggering ${WRAP_UP_COUNTDOWN_SECONDS}-second auto-cut in ${doctorActiveRoomId}.`);
                  this.signalingGateway.broadcastToRoom(doctorActiveRoomId, "server_wrap_up_warning", {
                    reason: "next_patient_time_reached",
                    remainingSeconds: WRAP_UP_COUNTDOWN_SECONDS,
                    patientName,
                    appointmentId,
                    appointmentTime: appointment.appointmentTime,
                    isNextPatientWaiting: true,
                  });
                  
                  timers.endCallTimeout = setTimeout(async () => {
                     console.log(`[JoinRoomUseCase] Auto-cut countdown completed for room ${doctorActiveRoomId}. Terminating.`);
                     this.signalingGateway.broadcastToRoom(doctorActiveRoomId, "force_end_call", {
                       reason: "next_patient_live",
                       appointmentId,
                       patientName,
                     });
                     const activeApptId = doctorActiveRoomId.replace('video_', '');
                     try {
                       const Appointment = mongoose.model('Appointment');
                       await Appointment.updateOne({ _id: activeApptId }, { status: 'completed' });
                     } catch(e) {}
                     clearRoomTimers(doctorActiveRoomId);
                  }, WRAP_UP_COUNTDOWN_SECONDS * 1000);
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
                  // ── Overlap flag (Rule 1.3) ─────────────────────────────────
                  // Both participants have connected → mark the successful overlap.
                  // This is the durable DB source of truth for re-join eligibility.
                  appointment.hasOverlapped = true;

                  const [timeStr, modifier] = (appointment.appointmentTime || "").trim().split(/\s+/);
                  if (timeStr) {
                    const scheduledStart = new Date(appointment.appointmentDate);
                    let [hours, minutes] = timeStr.split(":").map(Number);
                    if (modifier?.toUpperCase() === "PM" && hours < 12) hours += 12;
                    if (modifier?.toUpperCase() === "AM" && hours === 12) hours = 0;
                    scheduledStart.setHours(hours, minutes, 0, 0);

                    const timing = calculateConsultationTiming({
                      actualStartMs: appointment.sessionStartedAt.getTime(),
                      scheduledStartMs: scheduledStart.getTime(),
                      scheduledEndMs: scheduledStart.getTime() + baseDurationMinutes * 60000,
                      durationMinutes: baseDurationMinutes,
                      maxExtensionMinutes: MAX_EXTENSION_MINUTES,
                    });
                    appointment.sessionStartStatus = timing.sessionStatus;
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
                let appStartTime = null;
                if (app.scheduledStartAt) {
                  appStartTime = new Date(app.scheduledStartAt).getTime();
                } else {
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
                    appStartTime = appStart.getTime();
                  }
                }

                if (appStartTime) {
                  // Next slot overlaps extension time
                  if (appStartTime < maxExtensionEnd && appStartTime >= currentEnd - 5 * 60000) {
                    isNextSlotBooked = true;
                    nextAppointmentId = app._id ? app._id.toString() : null;
                    nextSlotStartTimeMs = appStartTime;
                    // Resolve the consultation type for the frontend timer logic
                    nextAppointmentType = ['offline', 'physical'].includes(app.consultationType)
                      ? 'offline'
                      : 'online';

                    // Next patient is ONLY present if actively waiting in the waiting room right now
                    const waitingKey = `waiting_${app._id.toString()}`;
                    const waitingGroup = waitingRoomParticipants.get(waitingKey);
                    if (waitingGroup && waitingGroup.size > 0) {
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

            // Calculate precise end times based on the 3 states from appointment-timing-rules.md
            const sessionStartMs = new Date(sessionStartedAt).getTime();
            const scheduledStartMs = scheduledStartDate.getTime();
            const scheduledEndMs = scheduledEndTimeObj.getTime();

            const timing = calculateConsultationTiming({
              actualStartMs: sessionStartMs,
              scheduledStartMs,
              scheduledEndMs,
              durationMinutes: baseDurationMinutes,
              maxExtensionMinutes: MAX_EXTENSION_MINUTES,
            });

            const sessionStatus = timing.sessionStatus;
            let primaryEndTimeMs = timing.durationEndMs;
            let absoluteHardLimitMs = timing.actualEndMs;

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
                let nextStartTimeMs = null;
                if (app.scheduledStartAt) {
                  nextStartTimeMs = new Date(app.scheduledStartAt).getTime();
                } else {
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
                    nextStartTimeMs = nextStart.getTime();
                  }
                }

                if (nextStartTimeMs && nextStartTimeMs > primaryEndTimeMs) {
                  if (!earliestNextStartTimeMs || nextStartTimeMs < earliestNextStartTimeMs) {
                    earliestNextStartTimeMs = nextStartTimeMs;
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
            // Absolute hard limit uses accurate 3-state calculated boundary (ActualEnd = DurationEnd + MAX_EXTENSION_MINUTES)
            const strictAbsoluteLimitMs = absoluteHardLimitMs || (startMs + (baseDurationMinutes + MAX_EXTENSION_MINUTES) * 60000);
            const delayUntilStrictHardLimit = Math.max(0, strictAbsoluteLimitMs - nowMs);
            
            timers.hardLimitTimeout = setTimeout(async () => {
              console.log(`[JoinRoomUseCase] Strict ${MAX_EXTENSION_MINUTES}-minute hard limit reached for room ${roomId}. Auto-terminating.`);
              this.signalingGateway.broadcastToRoom(roomId, "force_end_call", { reason: "max_extension_reached" });
              try {
                const mongoose = await import('mongoose');
                const Appointment = mongoose.model('Appointment');
                await Appointment.updateOne({ _id: appointmentId }, { status: 'completed', sessionEndedAt: new Date() });
              } catch(e) {}
              clearRoomTimers(roomId);
            }, delayUntilStrictHardLimit);

            // 2. Next Patient Exact Time Auto-Cut (ONLY if they are ACTUALLY waiting in the waiting room right now)
            const nextWaitingKey = nextAppointmentId ? `waiting_${nextAppointmentId}` : null;
            const isActuallyWaiting = Boolean(nextWaitingKey && waitingRoomParticipants.has(nextWaitingKey) && waitingRoomParticipants.get(nextWaitingKey).size > 0);

            if (nextSlotStartTimeMs && nextSlotStatus === 'PATIENT_PRESENT' && isActuallyWaiting) {
              const delayUntilNextSlot = Math.max(0, nextSlotStartTimeMs - nowMs);
              
              timers.wrapUpTimeout = setTimeout(() => {
                console.log(`[JoinRoomUseCase] Exact slot time reached for next patient. Triggering ${WRAP_UP_COUNTDOWN_SECONDS}-second auto-cut in ${roomId}.`);
                this.signalingGateway.broadcastToRoom(roomId, "server_wrap_up_warning", {
                  reason: "next_patient_time_reached",
                  remainingSeconds: WRAP_UP_COUNTDOWN_SECONDS,
                  appointmentId: nextAppointmentId,
                  isNextPatientWaiting: true,
                });
                
                timers.endCallTimeout = setTimeout(async () => {
                   console.log(`[JoinRoomUseCase] Auto-cut countdown completed for room ${roomId}. Terminating.`);
                   this.signalingGateway.broadcastToRoom(roomId, "force_end_call", {
                     reason: "next_patient_live",
                     appointmentId: nextAppointmentId,
                   });
                   try {
                     const mongoose = await import('mongoose');
                     const Appointment = mongoose.model('Appointment');
                     await Appointment.updateOne({ _id: appointmentId }, { status: 'completed' });
                   } catch(e) {}
                   clearRoomTimers(roomId);
                }, WRAP_UP_COUNTDOWN_SECONDS * 1000);
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
