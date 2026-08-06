import { Server } from "socket.io";

class SocketService {
  constructor() {
    this.io = null;
    // Map to store connected users: { userId: socketId }
    this.users = new Map();
  }

  init(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        credentials: true,
      },
    });

    this.io.on("connection", (socket) => {
      console.log(`[SocketService] New client connected: ${socket.id}`);

      // Expect the client to emit a "register" event with their userId and role
      socket.on("register", (data) => {
        const { userId, role } = data;
        if (userId) {
          this.users.set(userId.toString(), socket.id);
          console.log(`[SocketService] User registered: ${userId} (${role}) with socket: ${socket.id}`);

          // If the user is an admin, they can join an "admin" room
          if (role === "admin") {
            socket.join("admin_room");
            console.log(`[SocketService] Admin joined admin_room: ${userId}`);
          }
        }
      });

      socket.on("disconnect", () => {
        console.log(`[SocketService] Client disconnected: ${socket.id}`);
        // Remove the disconnected socket from our users map
        for (const [userId, socketId] of this.users.entries()) {
          if (socketId === socket.id) {
            this.users.delete(userId);
            console.log(`[SocketService] User removed from active connections: ${userId}`);
            break;
          }
        }
      });
    });

    console.log("[SocketService] Socket.io initialized successfully.");
  }

  emitNewBookingNotification(doctorId, bookingDetails) {
    if (!this.io) {
      console.error("[SocketService] Socket.io is not initialized!");
      return;
    }

    const payload = {
      message: "New booking received!",
      booking: bookingDetails,
      timestamp: new Date().toISOString(),
    };

    // 1. Notify the specific doctor if they are online
    const doctorSocketId = this.users.get(doctorId.toString());
    if (doctorSocketId) {
      this.io.to(doctorSocketId).emit("new_booking", payload);
      console.log(`[SocketService] Emitted new_booking to Doctor ${doctorId}`);
    } else {
      console.log(`[SocketService] Doctor ${doctorId} is not online. Notification skipped.`);
    }

    // 2. Notify all connected admins
    this.io.to("admin_room").emit("new_booking", payload);
    console.log(`[SocketService] Emitted new_booking to admin_room`);
  }
}

// Export a singleton instance
export const socketService = new SocketService();
