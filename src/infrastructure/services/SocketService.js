import { Server } from "socket.io";
import { registerWebRTCRoutes } from "../../modules/video-call/routes/socketRoutes.js";

class SocketService {
  constructor() {
    this.io = null;
    // Map to store connected users: { userId: Set<socketId> }
    this.users = new Map();
  }

  init(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        credentials: true,
      },
      pingTimeout: 5000,    // Detect disconnection after 5 seconds of unresponsiveness
      pingInterval: 10000,  // Ping the client every 10 seconds
    });

    this.io.on("connection", (socket) => {
      // console.log(`[SocketService] New client connected: ${socket.id}`);
// console log commented 
      // Expect the client to emit a "register" event with their userId and role
      socket.on("register", (data) => {
        const { userId, role } = data;
        if (userId) {
          const userStr = userId.toString();
          if (!this.users.has(userStr)) {
            this.users.set(userStr, new Set());
          }
          this.users.get(userStr).add(socket.id);
          
        //  console.log(`[SocketService] User registered: ${userId} (${role}) with socket: ${socket.id}`);
// console log commented 
          // If the user is an admin, they can join an "admin" room
          if (role === "admin") {
            socket.join("admin_room");
           // console.log(`[SocketService] Admin joined admin_room: ${userId}`);
          // console log commented 
          }
        }
      });

      // WebRTC Signaling Events
      registerWebRTCRoutes(socket, this.io);

      socket.on("disconnect", () => {
        // console.log(`[SocketService] Client disconnected: ${socket.id}`);
        // console log commented 
        // Remove the disconnected socket from our users map
        for (const [userId, sockets] of this.users.entries()) {
          if (sockets.has(socket.id)) {
            sockets.delete(socket.id);
            if (sockets.size === 0) {
              this.users.delete(userId);
              // console.log(`[SocketService] User removed from active connections: ${userId}`);
            // console log commented 
            }
            break;
          }
        }

        // WebRTC disconnect is handled by the video-call module
      });
    });

    // console.log("[SocketService] Socket.io initialized successfully.");
  // console log commented 
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
    const doctorSockets = this.users.get(doctorId.toString());
    if (doctorSockets && doctorSockets.size > 0) {
      for (const socketId of doctorSockets) {
        this.io.to(socketId).emit("new_booking", payload);
      }
      // console.log(`[SocketService] Emitted new_booking to Doctor ${doctorId} on ${doctorSockets.size} active tab(s)`);
    // console log commented 
    } else {

      // console.log(`[SocketService] Doctor ${doctorId} is not online. Notification skipped.`);
      // console log commented 
      
    }

    // 2. Notify all connected admins
    this.io.to("admin_room").emit("new_booking", payload);
    //console.log(`[SocketService] Emitted new_booking to admin_room`);
  //console log commented 
  }

  emitToUser(userId, event, payload) {
    if (!this.io) {
      console.error("[SocketService] Socket.io is not initialized!");
      return;
    }
    
    // Convert userId to string to ensure it matches the map key
    const sockets = this.users.get(userId.toString());
    if (sockets && sockets.size > 0) {
      for (const socketId of sockets) {
        this.io.to(socketId).emit(event, payload);
      }
      //console.log(`[SocketService] Emitted ${event} to User ${userId} on ${sockets.size} active tab(s)`);
    // console log commented
    } else {
      // console.log(`[SocketService] User ${userId} is not online. Event ${event} skipped.`);
      // console log commented
    }
  }

  emitToRoom(room, event, payload) {
    if (!this.io) {
      console.error("[SocketService] Socket.io is not initialized!");
      return;
    }
    this.io.to(room).emit(event, payload);
    // console.log(`[SocketService] Emitted ${event} to Room ${room}`);
  // console log commented
  }

  isUserOnline(userId) {
    if (!userId) return false;
    const sockets = this.users.get(userId.toString());
    return !!sockets && sockets.size > 0;
  }
}

// Export a singleton instance
export const socketService = new SocketService();
