export class SignalingGateway {
  constructor(socket, io) {
    this.socket = socket;
    this.io = io;
  }

  joinRoom(roomId) {
    this.socket.join(roomId);
    this.socket.currentVideoRoom = roomId;
  }

  getRoomSize(roomId) {
    const room = this.io.sockets.adapter.rooms.get(roomId);
    return room ? room.size : 0;
  }

  emitToRoom(roomId, event, payload) {
    this.socket.to(roomId).emit(event, payload);
  }

  broadcastToRoom(roomId, event, payload) {
    this.io.to(roomId).emit(event, payload);
  }

  emitToUser(userId, event, payload) {
    this.io.to(userId).emit(event, payload);
  }

  getCurrentRoom() {
    return this.socket.currentVideoRoom;
  }
}
