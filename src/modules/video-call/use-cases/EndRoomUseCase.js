import { roomStartTimes, roomActiveParticipants, clearRoomTimers, roomState, waitingRoomParticipants } from './JoinRoomUseCase.js';
import { MIN_CONSULTATION_DURATION_SECONDS } from '../../../config/videoCallConfig.js';
import Transaction from '../../../infrastructure/database/models/Transaction.js';
import Appointment from '../../../infrastructure/database/models/Appointment.js';

export class EndRoomUseCase {
  constructor(signalingGateway, appointmentRepository, transactionRepository) {
    this.signalingGateway = signalingGateway;
    this.appointmentRepository = appointmentRepository;
    this.transactionRepository = transactionRepository;
  } 

  async execute(appointmentId, userId, userRole, options = {}) {
    if (!appointmentId) return; 

    const roomId = `video_${appointmentId}`;
    const normalizedRole = userRole ? userRole.toLowerCase() : '';
    const isSystemForce = Boolean(options.isSystemForce);

    console.log(`[EndRoomUseCase] Ending room ${roomId} by user ${userId} (role: ${normalizedRole}, isSystemForce: ${isSystemForce})`);

    // 1. Fetch appointment to validate attendance and session timing
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      console.warn(`[EndRoomUseCase] Appointment ${appointmentId} not found.`);
      return;
    }

    // 2. Doctor-Only Conclusion Guard (Rule 8.2)
    // Only the doctor or system hard-stop can mark an appointment completed.
    if (!isSystemForce && normalizedRole !== 'doctor') {
      throw new Error("Only the doctor is permitted to conclude the consultation.");
    }

    // 3. Attendance Safeguard (Rule 8.1)
    // Both doctor and patient must have joined the session.
    const hasBothJoined = Boolean(appointment.doctorJoinedAt && appointment.patientJoinedAt);
    if (!hasBothJoined && !isSystemForce) {
      throw new Error("Consultation cannot be marked as completed because both participants have not actively joined the room.");
    }

    // 7. Update logs temporarily to check continuous overlap
    const now = new Date();
    let dOpenLog = null;
    let pOpenLog = null;

    if (appointment.patientAttendanceLogs?.length > 0) {
      pOpenLog = [...appointment.patientAttendanceLogs].reverse().find(l => !l.leftAt);
      if (pOpenLog) {
        pOpenLog.leftAt = now;
        pOpenLog.durationSeconds = Math.max(0, Math.round((now.getTime() - new Date(pOpenLog.joinedAt).getTime()) / 1000));
        if (pOpenLog.durationSeconds >= 60) {
          pOpenLog.isValidWait = true;
        }
      }
    }
    if (appointment.doctorAttendanceLogs?.length > 0) {
      dOpenLog = [...appointment.doctorAttendanceLogs].reverse().find(l => !l.leftAt);
      if (dOpenLog) {
        dOpenLog.leftAt = now;
        dOpenLog.durationSeconds = Math.max(0, Math.round((now.getTime() - new Date(dOpenLog.joinedAt).getTime()) / 1000));
      }
    }

    // 4. Minimum 3-Minute Active Consultation Lock (Rule 4)
    let has3MinContinuous = false;
    const doctorLogs = appointment.doctorAttendanceLogs || [];
    const patientLogs = appointment.patientAttendanceLogs || [];

    for (const dLog of doctorLogs) {
      if (!dLog.joinedAt) continue;
      const dJoin = new Date(dLog.joinedAt).getTime();
      const dLeave = dLog.leftAt ? new Date(dLog.leftAt).getTime() : now.getTime();

      for (const pLog of patientLogs) {
        if (!pLog.joinedAt) continue;
        const pJoin = new Date(pLog.joinedAt).getTime();
        const pLeave = pLog.leftAt ? new Date(pLog.leftAt).getTime() : now.getTime();

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

    if (!isSystemForce && !has3MinContinuous) {
      // Revert open logs since we are throwing an error
      if (pOpenLog) { pOpenLog.leftAt = undefined; pOpenLog.durationSeconds = undefined; }
      if (dOpenLog) { dOpenLog.leftAt = undefined; dOpenLog.durationSeconds = undefined; }
      throw new Error(`Minimum 3 continuous minutes of consultation is required before ending this session.`);
    }

    // 5. Broadcast call_ended to everyone in the room
    this.signalingGateway.broadcastToRoom(roomId, "call_ended", {
      appointmentId,
      endedBy: userId || 'system',
      status: 'completed',
      message: "The consultation has been ended."
    });

    // 6. Clean up in-memory state and active timers immediately
    roomStartTimes.delete(appointmentId);
    roomActiveParticipants.delete(roomId);
    clearRoomTimers(roomId);
    roomState.delete(roomId);
    waitingRoomParticipants.delete(`waiting_${appointmentId}`);

    // 7. Atomically update DB state to completed
    try {
      appointment.status = 'completed';
      appointment.sessionEndedAt = now;
      const updatedAppointment = await appointment.save();

      // ── Notify patient: consultation is permanently completed (Rule 4 / Rule 1.3) ──
      // Emitting 'consultation_completed' allows the patient's open appointments page
      // to immediately disable the re-join button without a page refresh.
      if (updatedAppointment?.patientId) {
        const patientUserId = updatedAppointment.patientId._id 
          ? updatedAppointment.patientId._id.toString() 
          : updatedAppointment.patientId.toString();

        // Primary call_ended event (room-level cleanup)
        this.signalingGateway.emitToUser(patientUserId, "call_ended", {
          appointmentId,
          endedBy: userId || 'system',
          status: 'completed',
          message: "The consultation has been ended."
        });

        // Secondary: explicit consultation_completed event so the appointments list
        // can react even if the patient is not currently in the video call room.
        this.signalingGateway.emitToUser(patientUserId, "consultation_completed", {
          appointmentId,
          status: 'completed',
          sessionEndedAt: updatedAppointment.sessionEndedAt?.toISOString(),
        });
      }

      // Update associated transaction status
      try {
        const finalTxStatus = has3MinContinuous ? 'completed' : 'cancelled';
        if (this.transactionRepository && typeof this.transactionRepository.updateStatusByAppointmentId === 'function') {
          await this.transactionRepository.updateStatusByAppointmentId(appointmentId, finalTxStatus);
        } else {
          await Transaction.findOneAndUpdate(
            { appointmentId },
            { status: finalTxStatus }
          );
        }
        console.log(`[EndRoomUseCase] Transaction for appointment ${appointmentId} updated to ${finalTxStatus}.`);
      } catch (txErr) {
        console.error(`[EndRoomUseCase] Error updating transaction for appointment ${appointmentId}:`, txErr);
      }

      console.log(`[EndRoomUseCase] Appointment ${appointmentId} marked as completed.`);
    } catch (err) {
      console.error("[EndRoomUseCase] Error updating appointment to completed:", err);
      throw err;
    }
  }
}
