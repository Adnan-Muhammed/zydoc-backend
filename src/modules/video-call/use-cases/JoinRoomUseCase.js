// In-memory store to keep track of sessionStartedAt for each room/appointment.
// Since it's in-memory, if the server restarts, ongoing calls will lose their timer sync.
export const roomStartTimes = new Map();

// In-memory store to track active participants per room: roomId -> Map<userId, socketId>
export const roomActiveParticipants = new Map();

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
          if (['completed', 'no-show', 'cancelled'].includes(appointment.status)) {
            // Emit error directly to the socket trying to join
            if (this.signalingGateway.socket?.id) {
              this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", { message: "This consultation has already ended." });
            }
            if (userId) {
              this.signalingGateway.emitToUser(userId, "call_error", { message: "This consultation has already ended." });
            }
            return; // Block join
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

            // Determine late entry cutoff time (from DB or fallback calculation)
            let lateJoinCutoffMs;
            let cutoffMinsForMessage = 40;
            if (appointment.lateJoinCutoffAt) {
                lateJoinCutoffMs = appointment.lateJoinCutoffAt.getTime();
                cutoffMinsForMessage = Math.round((lateJoinCutoffMs - scheduledStartMs) / 60000);
            } else {
                if (appointment.patientType === "NEW") {
                    cutoffMinsForMessage = 15;
                } else if (appointment.patientType === "FOLLOW_UP") {
                    cutoffMinsForMessage = 25;
                }
                lateJoinCutoffMs = scheduledStartMs + cutoffMinsForMessage * 60000;
            }

            // Block initial join if past the late entry cutoff
            if (!hasJoinedBefore && currentMs >= lateJoinCutoffMs) {
              const errMsg = { message: `The late entry cutoff window (${cutoffMinsForMessage} mins) has expired for this ${appointment.patientType} consultation.` };
              if (this.signalingGateway.socket?.id) this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
              if (userId) this.signalingGateway.emitToUser(userId, "call_error", errMsg);
              return; // Block join
            }
            
            // Always enforce absolute 40 min max window for everyone (even for re-joins)
            if (currentMs >= scheduledStartMs + 40 * 60000) {
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
            // Import dynamically or at top. Let's do a require or we can use mongoose.model
            // appointment.doctorId is the Profile ID. We need the SharedUser _id because the frontend socket registers with that.
            const mongoose = await import('mongoose');
            const SharedUser = mongoose.model('SharedUser');
            
            const [doctorUser, patientUser] = await Promise.all([
              SharedUser.findOne({ profileId: appointment.doctorId, role: 'doctor' }),
              SharedUser.findById(userId).populate('profileId')
            ]);
            
            if (doctorUser) {
              const pProfile = patientUser?.profileId || {};
              const patientName = `${pProfile.firstName || ''} ${pProfile.lastName || ''}`.trim() || patientUser?.googleName || "A patient";

              this.signalingGateway.emitToUser(
                doctorUser._id.toString(), 
                "patient-arrived", 
                { appointmentId, patientId: userId, patientName, patientType: appointment.patientType }
              );
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

            const baseDurationMinutes = 40;
            
            // Calculate scheduled end time based on appointment Date/Time + base duration
            const [timeStr, modifier] = (appointment.appointmentTime || "").split(" ");
            let [hours, minutes] = (timeStr || "").split(":");
            
            let scheduledStartDate = new Date(appointment.appointmentDate);
            if (hours !== undefined && minutes !== undefined) {
              let h = parseInt(hours, 10);
              if (modifier === "PM" && h < 12) h += 12;
              if (modifier === "AM" && h === 12) h = 0;
              scheduledStartDate.setHours(h, parseInt(minutes, 10), 0, 0);
            } else {
              scheduledStartDate = new Date(sessionStartedAt);
            }

            let scheduledEndTimeObj = new Date(scheduledStartDate);
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
                }
              }
            } else {
              scheduledEndTimeObj = new Date(scheduledStartDate.getTime() + baseDurationMinutes * 60000);
            }
            const scheduledEndTime = scheduledEndTimeObj.toISOString();

            // Check if there is an overlapping next appointment
            let isNextSlotBooked = false;
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
              const maxExtensionEnd = currentEnd + 15 * 60000;
              
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
            const maxExtensionMs = 15 * 60000; // 15-minute extension allowance

            if (sessionStatus === "EARLY") {
                primaryEndTimeMs = sessionStartMs + standardDurationMs;
                // Allow extension up to +15 mins past primary time until next patient joins
                absoluteHardLimitMs = primaryEndTimeMs + maxExtensionMs;
            } else if (sessionStatus === "ON_TIME") {
                primaryEndTimeMs = scheduledEndMs;
                // Allow extension past scheduled end time until next patient joins
                absoluteHardLimitMs = scheduledEndMs + maxExtensionMs;
            } else {
                // LATE start
                primaryEndTimeMs = Math.min(sessionStartMs + standardDurationMs, scheduledEndMs);
                absoluteHardLimitMs = primaryEndTimeMs + maxExtensionMs;
            }

            const primaryEndTime = new Date(primaryEndTimeMs).toISOString();
            const absoluteHardLimitTime = new Date(absoluteHardLimitMs).toISOString();

            // Broadcast timer details to all in the room
            this.signalingGateway.broadcastToRoom(roomId, "call_timer_started", {
              sessionStartedAt,
              scheduledEndTime,
              baseDurationMinutes,
              isNextSlotBooked,
              primaryEndTime,
              absoluteHardLimitTime
            });
          }
        }
      } catch (err) {
        console.error("[JoinRoomUseCase] Error setting up call timer:", err);
      }
    }
  }
}
