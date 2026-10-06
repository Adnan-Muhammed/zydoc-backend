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
    // Only the doctor or system hard-stop can conclude the consultation.
    if (!isSystemForce && normalizedRole !== 'doctor') {
      throw new Error("Only the doctor is permitted to conclude the consultation.");
    }

    const now = new Date();
    const nowMs = now.getTime();

    // Calculate exact scheduled window
    let startMs = appointment.scheduledStartAt ? new Date(appointment.scheduledStartAt).getTime() : 0;
    if (!startMs && appointment.appointmentDate && appointment.appointmentTime) {
      const [timeStr, modifier] = (appointment.appointmentTime || "").trim().split(/\s+/);
      if (timeStr) {
        const scheduledStartDate = new Date(appointment.appointmentDate);
        let [hours, minutes] = timeStr.split(":").map(Number);
        if (modifier?.toUpperCase() === "PM" && hours < 12) hours += 12;
        if (modifier?.toUpperCase() === "AM" && hours === 12) hours = 0;
        scheduledStartDate.setHours(hours, minutes, 0, 0);
        startMs = scheduledStartDate.getTime();
      }
    }

    let lateJoinCutoffMs = appointment.lateJoinCutoffAt ? new Date(appointment.lateJoinCutoffAt).getTime() : 0;
    if (!lateJoinCutoffMs && startMs) {
      lateJoinCutoffMs = startMs + 5 * 60 * 1000;
    }

    // Update logs with current timestamp
    let dOpenLog = null;
    let pOpenLog = null;

    if (appointment.patientAttendanceLogs?.length > 0) {
      pOpenLog = [...appointment.patientAttendanceLogs].reverse().find(l => !l.leftAt);
      if (pOpenLog) {
        pOpenLog.leftAt = now;
        pOpenLog.durationSeconds = Math.max(0, Math.round((nowMs - new Date(pOpenLog.joinedAt).getTime()) / 1000));
        
        if (startMs && lateJoinCutoffMs) {
          const joinMs = new Date(pOpenLog.joinedAt).getTime();
          const leaveMs = pOpenLog.leftAt.getTime();
          const overlapStart = Math.max(joinMs, startMs);
          const overlapEnd = Math.min(leaveMs, lateJoinCutoffMs);
          pOpenLog.isValidWait = (overlapEnd > overlapStart) && ((overlapEnd - overlapStart) / 1000 >= 60);
        } else {
          pOpenLog.isValidWait = false;
        }
      }
    }

    if (appointment.doctorAttendanceLogs?.length > 0) {
      dOpenLog = [...appointment.doctorAttendanceLogs].reverse().find(l => !l.leftAt);
      if (dOpenLog) {
        dOpenLog.leftAt = now;
        dOpenLog.durationSeconds = Math.max(0, Math.round((nowMs - new Date(dOpenLog.joinedAt).getTime()) / 1000));
      }
    }

    // STRICT RULE 1 & 2: Evaluate patient wait strictly within [startMs, lateJoinCutoffMs]
    const hasValidPatientWait = (appointment.patientAttendanceLogs || []).some(log => {
      if (!log.joinedAt || !startMs || !lateJoinCutoffMs) return false;
      const joinMs = new Date(log.joinedAt).getTime();

      // If log ended before or at scheduled start, ignore completely (Rule 1)
      if (log.leftAt && new Date(log.leftAt).getTime() <= startMs) return false;
      // If patient joined before scheduled start and left without leftAt recorded,
      // do NOT assume they stayed into the valid window
      if (!log.leftAt && joinMs < startMs) return false;
      if (joinMs >= lateJoinCutoffMs) return false;

      const leaveMs = log.leftAt ? new Date(log.leftAt).getTime() : nowMs;
      const overlapStart = Math.max(joinMs, startMs);
      const overlapEnd = Math.min(leaveMs, lateJoinCutoffMs);
      if (overlapEnd > overlapStart) {
        const overlapSeconds = (overlapEnd - overlapStart) / 1000;
        return overlapSeconds >= 60;
      }
      return false;
    });

    // Check continuous overlap between doctor and patient logs
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

    const hasConsultationStarted = Boolean(
      appointment.hasOverlapped ||
      appointment.sessionStartedAt ||
      (appointment.doctorJoinedAt && appointment.patientJoinedAt)
    );

    // ── 1. MANDATORY 3-MINUTE CONTINUOUS PRESENCE GUARD ──
    // If the consultation has started (doctor and patient connected via Early Start or Scheduled Start),
    // or if the patient met valid attendance, the doctor MUST complete at least 3 continuous minutes.
    // If disconnected before completing 3 minutes, they must rejoin to finish the duration.
    if ((hasConsultationStarted || hasValidPatientWait) && !has3MinContinuous && !isSystemForce) {
      if (pOpenLog) { pOpenLog.leftAt = undefined; pOpenLog.durationSeconds = undefined; }
      if (dOpenLog) { dOpenLog.leftAt = undefined; dOpenLog.durationSeconds = undefined; }
      throw new Error("Minimum 3 continuous minutes of consultation is required before ending this session. If disconnected, participants must rejoin to complete the consultation.");
    }

    // ── 2. SCENARIO A: PATIENT NO-SHOW / ORPHANED APPOINTMENT MANUAL CLOSURE ──
    // Only permitted if the consultation NEVER started and the patient never fulfilled valid wait
    if (!has3MinContinuous && !hasValidPatientWait && !hasConsultationStarted) {
      console.log(`[EndRoomUseCase] Doctor manually concluded orphaned/no-show appointment ${appointmentId}. Marking as no-show with NO patient refund.`);

      appointment.status = 'no-show';
      appointment.doctorFault = false;
      appointment.sessionEndedAt = now;
      await appointment.save();

      // Clean up in-memory room state and timers
      roomStartTimes.delete(appointmentId);
      roomActiveParticipants.delete(roomId);
      clearRoomTimers(roomId);
      roomState.delete(roomId);
      waitingRoomParticipants.delete(`waiting_${appointmentId}`);

      // Broadcast call_ended to room
      this.signalingGateway.broadcastToRoom(roomId, "call_ended", {
        appointmentId,
        endedBy: userId || 'doctor',
        status: 'no-show',
        message: "The consultation has been ended and marked as patient no-show."
      });

      // Notify patient if user ID exists
      if (appointment.patientId) {
        const patientUserId = appointment.patientId._id 
          ? appointment.patientId._id.toString() 
          : appointment.patientId.toString();

        this.signalingGateway.emitToUser(patientUserId, "call_ended", {
          appointmentId,
          endedBy: userId || 'doctor',
          status: 'no-show',
          message: "The consultation has been ended."
        });

        this.signalingGateway.emitToUser(patientUserId, "consultation_completed", {
          appointmentId,
          status: 'no-show',
          sessionEndedAt: now.toISOString(),
        });
      }

      // Update associated transaction status to completed (doctor keeps payout, no refund)
      try {
        if (this.transactionRepository && typeof this.transactionRepository.updateStatusByAppointmentId === 'function') {
          await this.transactionRepository.updateStatusByAppointmentId(appointmentId, 'completed');
        } else {
          await Transaction.findOneAndUpdate(
            { appointmentId },
            { status: 'completed' }
          );
        }
        console.log(`[EndRoomUseCase] Transaction for appointment ${appointmentId} preserved as completed (no refund).`);
      } catch (txErr) {
        console.error(`[EndRoomUseCase] Error updating transaction for appointment ${appointmentId}:`, txErr);
      }

      return {
        success: true,
        status: 'no-show',
        message: "Consultation successfully concluded and marked as patient no-show."
      };
    }

    // ── 3. SCENARIO B: ACTIVE CONSULTATION WITHOUT 3 MINUTES (Fallback Guard) ──
    if (!isSystemForce && !has3MinContinuous) {
      if (pOpenLog) { pOpenLog.leftAt = undefined; pOpenLog.durationSeconds = undefined; }
      if (dOpenLog) { dOpenLog.leftAt = undefined; dOpenLog.durationSeconds = undefined; }
      throw new Error(`Minimum 3 continuous minutes of consultation is required before ending this session. If disconnected, participants must rejoin to complete the consultation.`);
    }

    // ── 4. SCENARIO C: SUCCESSFUL CONSULTATION COMPLETED ──
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

      // ── Notify patient: consultation is permanently completed ──
      if (updatedAppointment?.patientId) {
        const patientUserId = updatedAppointment.patientId._id 
          ? updatedAppointment.patientId._id.toString() 
          : updatedAppointment.patientId.toString();

        this.signalingGateway.emitToUser(patientUserId, "call_ended", {
          appointmentId,
          endedBy: userId || 'system',
          status: 'completed',
          message: "The consultation has been ended."
        });

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
      return {
        success: true,
        status: 'completed',
        message: "Consultation successfully concluded and completed."
      };
    } catch (err) {
      console.error("[EndRoomUseCase] Error updating appointment to completed:", err);
      throw err;
    }
  }
}
