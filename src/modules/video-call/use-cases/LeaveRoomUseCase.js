import { roomStartTimes, roomActiveParticipants } from './JoinRoomUseCase.js';

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
    
    // Cleanup stuck state if room is empty
    if (size === 0) {
      const appointmentId = roomId.replace("video_", "");
      
      // Remove from in-memory timers and active participants
      roomStartTimes.delete(appointmentId);
      roomActiveParticipants.delete(roomId);
      
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
