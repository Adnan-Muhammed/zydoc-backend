import { roomStartTimes, roomActiveParticipants, clearRoomTimers, roomState, waitingRoomParticipants } from './JoinRoomUseCase.js';
import Transaction from '../../../infrastructure/database/models/Transaction.js';
import Appointment from '../../../infrastructure/database/models/Appointment.js';

export class EndRoomUseCase {
  constructor(signalingGateway, appointmentRepository, transactionRepository) {
    this.signalingGateway = signalingGateway;
    this.appointmentRepository = appointmentRepository;
    this.transactionRepository = transactionRepository;
  }

  async execute(appointmentId, userId, userRole) {
    if (!appointmentId) return; 

    const roomId = `video_${appointmentId}`;
    const normalizedRole = userRole ? userRole.toLowerCase() : '';

    console.log(`[EndRoomUseCase] Ending room ${roomId} by user ${userId} (role: ${normalizedRole})`);

    // 1. Tell everyone in the room immediately that the call is officially ended
    this.signalingGateway.broadcastToRoom(roomId, "call_ended", {
      appointmentId,
      endedBy: userId,
      status: 'completed',
      message: "The consultation has been ended."
    });

    // 2. Clean up in-memory state and active timers immediately
    roomStartTimes.delete(appointmentId);
    roomActiveParticipants.delete(roomId);
    clearRoomTimers(roomId);
    roomState.delete(roomId);
    waitingRoomParticipants.delete(`waiting_${appointmentId}`);

    // 3. Atomically update DB state to completed
    try {
      const updatedAppointment = await Appointment.findByIdAndUpdate(
        appointmentId,
        { $set: { status: 'completed', sessionEndedAt: new Date() } },
        { new: true }
      );

      if (updatedAppointment?.patientId) {
        const patientUserId = updatedAppointment.patientId._id 
          ? updatedAppointment.patientId._id.toString() 
          : updatedAppointment.patientId.toString();
        this.signalingGateway.emitToUser(patientUserId, "call_ended", {
          appointmentId,
          endedBy: userId,
          status: 'completed',
          message: "The consultation has been ended."
        });
      }

      // Update associated transaction status to 'completed'
      try {
        if (this.transactionRepository && typeof this.transactionRepository.updateStatusByAppointmentId === 'function') {
          await this.transactionRepository.updateStatusByAppointmentId(appointmentId, 'completed');
        } else {
          await Transaction.findOneAndUpdate(
            { appointmentId },
            { status: 'completed' }
          );
        }
        console.log(`[EndRoomUseCase] Transaction for appointment ${appointmentId} updated to completed.`);
      } catch (txErr) {
        console.error(`[EndRoomUseCase] Error updating transaction for appointment ${appointmentId}:`, txErr);
      }

      console.log(`[EndRoomUseCase] Appointment ${appointmentId} marked as completed.`);
    } catch (err) {
      console.error("[EndRoomUseCase] Error updating appointment to completed:", err);
    }
  }
}
