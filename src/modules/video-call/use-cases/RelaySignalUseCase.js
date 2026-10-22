export class RelaySignalUseCase {
  constructor(signalingGateway) {
    this.signalingGateway = signalingGateway;
  }

  execute(appointmentId, event, payload) {
    if (!appointmentId) return;
    const roomId = `video_${appointmentId}`;
    console.info("[webrtc-signal] relaying event", {
      appointmentId: String(appointmentId),
      roomId,
      event,
      roomMembers: this.signalingGateway.getRoomSize(roomId),
    });
    this.signalingGateway.emitToRoom(roomId, event, payload);
  }
}
