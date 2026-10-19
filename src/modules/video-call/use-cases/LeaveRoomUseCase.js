import { roomStartTimes, roomActiveParticipants } from './JoinRoomUseCase.js';
import { MIN_CONSULTATION_DURATION_SECONDS } from '../../../config/videoCallConfig.js';

export class LeaveRoomUseCase {
  constructor(signalingGateway, appointmentRepository) {
    this.signalingGateway = signalingGateway;
    this.appointmentRepository = appointmentRepository;
  }

  async execute(roomId, role, userId, socketId) {
    if (!roomId) return;  

    // Remove user/socket from active participants map
    if (roomActiveParticipants.has(roomId)) {
      const participants = roomActiveParticipants.get(roomId);
      if (userId) {
        if (!socketId || participants.get(userId) === socketId) {
          participants.delete(userId);
        }
      } else if (socketId) {
        for (const [uId, sId] of participants.entries()) {
          if (sId === socketId) {
            participants.delete(uId);
            break;
          }
        }
      }
      if (participants.size === 0) {
        roomActiveParticipants.delete(roomId);
      }
    }

    // Emit peer_left to anyone still in the room
    this.signalingGateway.emitToRoom(roomId, "peer_left");

    // Check if the room is now empty
    const size = this.signalingGateway.getRoomSize(roomId);
    
    // Cleanup and attendance tracking
    const appointmentId = roomId.replace("video_", "");
    if (this.appointmentRepository) {
      try {
        const appointment = await this.appointmentRepository.findById(appointmentId);
        if (appointment) {
          const now = new Date();
          const normalizedRole = role ? role.toLowerCase() : '';

          const startMs = appointment.scheduledStartAt ? new Date(appointment.scheduledStartAt).getTime() : 0;
          let lateJoinCutoffMs = appointment.lateJoinCutoffAt ? new Date(appointment.lateJoinCutoffAt).getTime() : 0;
          if (!lateJoinCutoffMs && startMs) {
            lateJoinCutoffMs = startMs + 5 * 60 * 1000;
          }

          // ── Update Attendance Logs (Rule 2.2) ───────────────────────────
          if (normalizedRole === 'patient' && appointment.patientAttendanceLogs?.length > 0) {
            const openLog = [...appointment.patientAttendanceLogs].reverse().find(l => !l.leftAt);
            if (openLog) {
              openLog.leftAt = now;
              openLog.durationSeconds = Math.max(0, Math.round((openLog.leftAt.getTime() - new Date(openLog.joinedAt).getTime()) / 1000));
              
              // STRICT RULE: isValidWait is only true if patient was present >= 60 seconds WITHIN [startMs, lateJoinCutoffMs]
              if (startMs && lateJoinCutoffMs) {
                const joinMs = new Date(openLog.joinedAt).getTime();
                const leaveMs = openLog.leftAt.getTime();
                const overlapStart = Math.max(joinMs, startMs);
                const overlapEnd = Math.min(leaveMs, lateJoinCutoffMs);
                openLog.isValidWait = (overlapEnd > overlapStart) && ((overlapEnd - overlapStart) / 1000 >= 60);
              } else {
                openLog.isValidWait = false;
              }
            }
          } else if (normalizedRole === 'doctor' && appointment.doctorAttendanceLogs?.length > 0) {
            const openLog = [...appointment.doctorAttendanceLogs].reverse().find(l => !l.leftAt);
            if (openLog) {
              openLog.leftAt = now;
              openLog.durationSeconds = Math.max(0, Math.round((openLog.leftAt.getTime() - new Date(openLog.joinedAt).getTime()) / 1000));
            }
          }

          // Check if the room is now completely empty
          if (size === 0) {
            // Remove from in-memory timers and active participants
            roomStartTimes.delete(appointmentId);
            roomActiveParticipants.delete(roomId);

            if (appointment.status !== 'completed' && appointment.status !== 'cancelled' && appointment.status !== 'doctor_missed') {
              const nowMs = Date.now();

              // STRICT RULE 1 & 2: Evaluate patient wait strictly within [startMs, lateJoinCutoffMs]
              const hasValidPatientWait = appointment.patientAttendanceLogs?.some(log => {
                if (!log.joinedAt || !startMs || !lateJoinCutoffMs) return false;
                const joinMs = new Date(log.joinedAt).getTime();

                // If log ended before or at scheduled start, ignore completely
                if (log.leftAt && new Date(log.leftAt).getTime() <= startMs) return false;
                // If patient joined before scheduled start and has no leftAt, do not assume they stayed into valid window
                if (!log.leftAt && joinMs < startMs) return false;
                if (joinMs >= lateJoinCutoffMs) return false;

                const leaveMs = log.leftAt ? new Date(log.leftAt).getTime() : nowMs;
                const overlapStart = Math.max(joinMs, startMs);
                const overlapEnd = Math.min(leaveMs, lateJoinCutoffMs);
                return (overlapEnd > overlapStart) && ((overlapEnd - overlapStart) / 1000 >= 60);
              });

              let totalOverlapSeconds = 0;
              const doctorLogs = appointment.doctorAttendanceLogs || [];
              const patientLogs = appointment.patientAttendanceLogs || [];

              for (const dLog of doctorLogs) {
                if (!dLog.joinedAt) continue;
                const dJoin = new Date(dLog.joinedAt).getTime();
                const dLeave = dLog.leftAt ? new Date(dLog.leftAt).getTime() : nowMs;

                for (const pLog of patientLogs) {
                  if (!pLog.joinedAt) continue;
                  const pJoin = new Date(pLog.joinedAt).getTime();
                  const pLeave = pLog.leftAt ? new Date(pLog.leftAt).getTime() : nowMs;

                  const overlapStart = Math.max(dJoin, pJoin);
                  const overlapEnd = Math.min(dLeave, pLeave);

                  if (overlapEnd > overlapStart) {
                    totalOverlapSeconds += (overlapEnd - overlapStart) / 1000;
                  }
                }
              }

              const has3MinContinuous = totalOverlapSeconds >= MIN_CONSULTATION_DURATION_SECONDS;

              const slotDurationMins = (appointment.scheduledStartAt && appointment.scheduledEndAt)
                ? Math.round((new Date(appointment.scheduledEndAt) - new Date(appointment.scheduledStartAt)) / 60000)
                : 15;
              const slotEndMs = appointment.scheduledEndAt
                ? new Date(appointment.scheduledEndAt).getTime()
                : (startMs + slotDurationMins * 60000);

              const hasConsultationStarted = Boolean(
                appointment.hasOverlapped ||
                appointment.sessionStartedAt ||
                (appointment.doctorJoinedAt && appointment.patientJoinedAt)
              );

              if (hasConsultationStarted) {
                // Rule 1: Once consultation has started, late cut-off rules no longer apply.
                // Participants retain the full right to re-join prior to Scheduled End Time (slotEndMs).
                if (nowMs < slotEndMs) {
                  appointment.status = 'scheduled';
                  await appointment.save();
                  console.log(`[LeaveRoomUseCase] Consultation in progress. Participants disconnected prior to slot end (${new Date(slotEndMs).toISOString()}). Retaining scheduled status for re-join.`);
                } else {
                  // Slot duration has fully elapsed without explicit doctor completion
                  if (has3MinContinuous) {
                    console.log(`[LeaveRoomUseCase] Slot ended and 3-min continuous consultation was met. Auto-completing appointment ${appointmentId}.`);
                    appointment.status = 'completed';
                    await appointment.save();
                  } else if (hasValidPatientWait) {
                    console.log(`[LeaveRoomUseCase] Slot ended without doctor completing 3-min consultation for ${appointmentId}. Marking doctor_missed.`);
                    appointment.doctorFault = true;
                    if (typeof this.appointmentRepository.markDoctorMissed === 'function') {
                      await this.appointmentRepository.markDoctorMissed(appointment);
                    }
                  } else {
                    appointment.status = 'no-show';
                    appointment.doctorFault = false;
                    await appointment.save();
                  }
                }
              } else {
                // Consultation never started (participants never met in room)
                if (nowMs >= lateJoinCutoffMs) {
                  if (hasValidPatientWait && !appointment.doctorJoinedAt) {
                    console.log(`[LeaveRoomUseCase] Valid patient wait verified but doctor never joined for ${appointmentId}. Marking doctor_missed.`);
                    appointment.doctorFault = true;
                    if (typeof this.appointmentRepository.markDoctorMissed === 'function') {
                      await this.appointmentRepository.markDoctorMissed(appointment);
                    }
                    if (userId) {
                      this.signalingGateway.emitToUser(userId, "doctor_missed", {
                        appointmentId,
                        message: "The doctor did not complete the consultation. A full refund has been credited to your wallet.",
                      });
                    }
                  } else if (!hasValidPatientWait) {
                    console.log(`[LeaveRoomUseCase] Room empty and cutoff passed for un-started ${appointmentId}. Auto-closing as no-show.`);
                    appointment.status = 'no-show';
                    appointment.doctorFault = false;
                    await appointment.save();

                    this.signalingGateway.emitToRoom(roomId, "call_ended", {
                      appointmentId,
                      status: 'no-show',
                      message: "The consultation has ended as a patient no-show."
                    });
                    if (appointment.patientId) {
                      const pId = appointment.patientId._id ? appointment.patientId._id.toString() : appointment.patientId.toString();
                      this.signalingGateway.emitToUser(pId, "consultation_completed", { appointmentId, status: 'no-show' });
                    }
                  }
                } else {
                  appointment.status = 'scheduled';
                  await appointment.save();
                  console.log(`[LeaveRoomUseCase] Room empty before cutoff. Kept appointment ${appointmentId} as scheduled.`);
                }
              }
            }
          } else {
            // Room still has other participants, save the attendance logs
            await appointment.save();
          }
        }
      } catch (err) {
        console.error("[LeaveRoomUseCase] Error processing leave room attendance and status:", err);
      }
    }
  }
}
