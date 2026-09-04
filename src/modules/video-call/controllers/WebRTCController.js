import { SignalingGateway } from '../repositories/SignalingGateway.js';
import { JoinRoomUseCase } from '../use-cases/JoinRoomUseCase.js';
import { RelaySignalUseCase } from '../use-cases/RelaySignalUseCase.js';
import { LeaveRoomUseCase } from '../use-cases/LeaveRoomUseCase.js';
import { EndRoomUseCase } from '../use-cases/EndRoomUseCase.js';
import { MongoAppointmentRepository } from '../../../infrastructure/repositories/MongoAppointmentRepository.js';
import { MongoTransactionRepository } from '../../../infrastructure/repositories/MongoTransactionRepository.js';

export class WebRTCController {
  static handle(socket, io) {
    const gateway = new SignalingGateway(socket, io);
    const appointmentRepository = new MongoAppointmentRepository();
    const transactionRepository = new MongoTransactionRepository();
    const joinRoom = new JoinRoomUseCase(gateway, appointmentRepository);
    const relaySignal = new RelaySignalUseCase(gateway);
    const leaveRoom = new LeaveRoomUseCase(gateway, appointmentRepository);
    const endRoom = new EndRoomUseCase(gateway, appointmentRepository, transactionRepository);

    socket.on("register", ({ userId, role }) => {
      socket.userId = userId;
      socket.userRole = role;
      socket.join(userId);
    });

    socket.on("join_room", ({ appointmentId }) => {
      joinRoom.execute(appointmentId, socket.userId, socket.userRole);
    });

    socket.on("webrtc_offer", ({ appointmentId, offer }) => {
      relaySignal.execute(appointmentId, "webrtc_offer", { offer });
    });

    socket.on("webrtc_answer", ({ appointmentId, answer }) => {
      relaySignal.execute(appointmentId, "webrtc_answer", { answer });
    });

    socket.on("webrtc_ice_candidate", ({ appointmentId, candidate }) => {
      relaySignal.execute(appointmentId, "webrtc_ice_candidate", { candidate });
    });

    socket.on("end_call", ({ appointmentId }) => {
      endRoom.execute(appointmentId, socket.userId, socket.userRole);
    });

    socket.on("leave_room", ({ appointmentId } = {}) => {
      const roomId = appointmentId ? `video_${appointmentId}` : socket.currentVideoRoom;
      leaveRoom.execute(roomId, socket.userRole, socket.userId, socket.id);
    });

    // Handle peer disconnect for WebRTC specific cleanup
    socket.on("disconnect", () => {
      // For edge case: if they close the tab, LeaveRoomUseCase handles it
      leaveRoom.execute(socket.currentVideoRoom, socket.userRole, socket.userId, socket.id);
    });

  }
}
