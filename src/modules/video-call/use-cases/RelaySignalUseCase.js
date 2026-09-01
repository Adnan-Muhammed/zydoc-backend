export class RelaySignalUseCase {
  constructor(signalingGateway) {
    this.signalingGateway = signalingGateway;
  }

  execute(appointmentId, event, payload) {
    if (!appointmentId) return;
    const roomId = `video_${appointmentId}`;
    this.signalingGateway.emitToRoom(roomId, event, payload);
  }
}
