import { roomStartTimes, roomActiveParticipants } from './JoinRoomUseCase.js';
import Transaction from '../../../infrastructure/database/models/Transaction.js';

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
    
    try {
      if (this.appointmentRepository) {
        const appointment = await this.appointmentRepository.findById(appointmentId);
        
        if (appointment) {
          if (normalizedRole === 'doctor') {
            appointment.status = 'completed';
            appointment.sessionEndedAt = new Date();

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
          } else {
            appointment.status = 'scheduled';
          }
          
          await appointment.save();

          console.log(`[EndRoomUseCase] Appointment ${appointmentId} marked as ${appointment.status}.`);
        }
      }

      // Cleanup in-memory state
      roomStartTimes.delete(appointmentId);
      roomActiveParticipants.delete(roomId);

      // Tell everyone in the room that the call is officially ended
      this.signalingGateway.broadcastToRoom(roomId, "call_ended", {
        appointmentId,
        message: "The consultation has been ended."
      });

    } catch (err) {
      console.error("[EndRoomUseCase] Error ending the call:", err);
    }
  }
}
