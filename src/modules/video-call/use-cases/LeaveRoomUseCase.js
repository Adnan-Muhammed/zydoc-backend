import { roomStartTimes } from './JoinRoomUseCase.js';

export class LeaveRoomUseCase {
  constructor(signalingGateway, appointmentRepository) {
    this.signalingGateway = signalingGateway;
    this.appointmentRepository = appointmentRepository;
  }

  async execute(roomId, role) {
    if (!roomId) return;

    // Emit peer_left to anyone still in the room
    this.signalingGateway.emitToRoom(roomId, "peer_left");

    // Check if the room is now empty
    const size = this.signalingGateway.getRoomSize(roomId);
    
    // Cleanup stuck state if room is empty
    if (size === 0) {
      const appointmentId = roomId.replace("video_", "");
      
      // Remove from in-memory timers
      roomStartTimes.delete(appointmentId);
      
      // Update DB if we have access to the repository
      if (this.appointmentRepository) {
        try {
          const appointment = await this.appointmentRepository.findById(appointmentId);
          if (appointment && appointment.status !== 'completed' && appointment.status !== 'cancelled') {
            appointment.status = 'scheduled';
            await appointment.save();
            console.log(`[LeaveRoomUseCase] Room empty. Kept appointment ${appointmentId} as scheduled.`);
          }
        } catch (err) {
          console.error("[LeaveRoomUseCase] Error cleaning up appointment:", err);
        }
      }
    }
  }
}
