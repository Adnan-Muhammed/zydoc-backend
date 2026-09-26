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

          // ── Update Attendance Logs (Rule 2.2) ───────────────────────────
          if (normalizedRole === 'patient' && appointment.patientAttendanceLogs?.length > 0) {
            const openLog = [...appointment.patientAttendanceLogs].reverse().find(l => !l.leftAt);
            if (openLog) {
              openLog.leftAt = now;
              openLog.durationSeconds = Math.max(0, Math.round((openLog.leftAt.getTime() - new Date(openLog.joinedAt).getTime()) / 1000));
              if (openLog.durationSeconds >= 60) {
                openLog.isValidWait = true;
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
              const startMs = appointment.scheduledStartAt ? new Date(appointment.scheduledStartAt).getTime() : 0;
              let lateJoinCutoffMs = appointment.lateJoinCutoffAt ? new Date(appointment.lateJoinCutoffAt).getTime() : 0;
              if (!lateJoinCutoffMs && startMs) {
                lateJoinCutoffMs = startMs + 5 * 60 * 1000;
              }

              const hasValidPatientWait = appointment.patientAttendanceLogs?.some(log => {
                if (!log.joinedAt || !startMs || !lateJoinCutoffMs) return false;
                const joinMs = new Date(log.joinedAt).getTime();
                const leaveMs = log.leftAt ? new Date(log.leftAt).getTime() : nowMs;
                const overlapStart = Math.max(joinMs, startMs);
                const overlapEnd = Math.min(leaveMs, lateJoinCutoffMs);
                return (overlapEnd > overlapStart) && ((overlapEnd - overlapStart) / 1000 >= 60);
              });

              let has3MinContinuous = false;
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
                    const overlapSeconds = (overlapEnd - overlapStart) / 1000;
                    if (overlapSeconds >= MIN_CONSULTATION_DURATION_SECONDS) {
                      has3MinContinuous = true;
                      break;
                    }
                  }
                }
                if (has3MinContinuous) break;
              }

              if (nowMs >= lateJoinCutoffMs) {
                if (hasValidPatientWait && (!appointment.doctorJoinedAt || !has3MinContinuous)) {
                  console.log(`[LeaveRoomUseCase] Valid patient wait verified (≥60s) but doctor failed to complete 3-min consultation for ${appointmentId}. Logging doctorFault and auto-refunding...`);
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
                  console.log(`[LeaveRoomUseCase] Room empty and cutoff passed for ${appointmentId}. Auto-closing as no-show.`);
                  appointment.status = 'no-show';
                  appointment.doctorFault = false;
                  await appointment.save();
                } else {
                  console.log(`[LeaveRoomUseCase] Room empty and cutoff passed. Doctor completed 3 mins but didn't click end. Auto-completing.`);
                  appointment.status = 'completed';
                  await appointment.save();
                }
              } else {
                appointment.status = 'scheduled';
                await appointment.save();
                console.log(`[LeaveRoomUseCase] Room empty before cutoff. Kept appointment ${appointmentId} as scheduled.`);
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
