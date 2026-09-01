import { roomStartTimes } from './JoinRoomUseCase.js';

export class EndRoomUseCase {
  constructor(signalingGateway, appointmentRepository) {
    this.signalingGateway = signalingGateway;
    this.appointmentRepository = appointmentRepository;
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
          } else {
            appointment.status = 'scheduled';
          }
          
          await appointment.save();

          console.log(`[EndRoomUseCase] Appointment ${appointmentId} marked as ${appointment.status}.`);
        }
      }

      // Cleanup in-memory state
      roomStartTimes.delete(appointmentId);

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
