import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { registerWebRTCRoutes } from "../../modules/video-call/routes/socketRoutes.js";

class SocketService {
  constructor() {
    this.io = null;
    // Map to store connected users: { userId: Set<socketId> }
    this.users = new Map();
  }

  init(server) {

     const allowedOrigins = Array.from(new Set([
      process.env.CLIENT_URL,
      'https://carehealth.online',
      'https://www.carehealth.online',
      'http://localhost:3000',
    ].filter(Boolean)));

    this.io = new Server(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        credentials: true,
      },
      pingTimeout: 5000,    // Detect disconnection after 5 seconds of unresponsiveness
      pingInterval: 10000,  // Ping the client every 10 seconds
    });

    // 🔒 Enforce JWT Handshake Authentication
    this.io.use((socket, next) => this.authenticateSocket(socket, next));

    this.io.on("connection", (socket) => this.handleConnection(socket));
  }

  authenticateSocket(socket, next) {
    try {
      let token = socket.handshake.auth?.token;
      if (!token && socket.handshake.headers?.authorization?.startsWith("Bearer ")) {
        token = socket.handshake.headers.authorization.split(" ")[1];
      }
      if (!token && socket.handshake.headers?.cookie) {
        const match = socket.handshake.headers.cookie.match(/(?:^|;\s*)accessToken=([^;]+)/);
        if (match) token = decodeURIComponent(match[1]);
      }

      if (!token || token === "null" || token === "undefined") {
        return next(new Error("Unauthorized: No token provided in socket handshake"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET || "access_secret");
      socket.user = decoded;
      socket.userId = (decoded.id || decoded._id)?.toString();
      socket.userRole = decoded.role ? decoded.role.toLowerCase() : null;

      if (!socket.userId) {
        return next(new Error("Unauthorized: Invalid user payload in token"));
      }

      next();
    } catch (err) {
      return next(new Error(`Unauthorized: ${err.message}`));
    }
  }

  handleConnection(socket) {
    console.info("[socket] connected", {
      socketId: socket.id,
      role: socket.userRole,
      origin: socket.handshake.headers?.origin,
      transport: socket.conn?.transport?.name,
    });

    // Automatically register the verified user and join their private user room
    if (socket.userId) {
      const userStr = socket.userId;
      if (!this.users.has(userStr)) {
        this.users.set(userStr, new Set());
      }
      this.users.get(userStr).add(socket.id);
      socket.join(userStr);

      // Join admin_room strictly if verified JWT role is admin
      if (socket.userRole === "admin") {
        socket.join("admin_room");
      }

      // Also register doctor profileId so doctor can be reached by profileId
      if (socket.userRole === "doctor") {
        import("mongoose").then(async (mongooseModule) => {
          try {
            const mongoose = mongooseModule.default || mongooseModule;
            const SharedUser = mongoose.model("SharedUser");
            const userDoc = await SharedUser.findById(socket.userId).select("profileId");
            if (userDoc?.profileId) {
              const profileStr = userDoc.profileId.toString();
              if (!this.users.has(profileStr)) {
                this.users.set(profileStr, new Set());
              }
              this.users.get(profileStr).add(socket.id);
              socket.join(profileStr);
            }
          } catch (err) {
            console.error("[SocketService] Error registering doctor profileId:", err);
          }
        });
      }
    }

    // Register profileId emitted by client (e.g. Topbar.tsx registering with doctor profileId)
    socket.on("register", (data) => {
      if (data?.userId && socket.userId) {
        const customId = data.userId.toString();
        if (!this.users.has(customId)) {
          this.users.set(customId, new Set());
        }
        this.users.get(customId).add(socket.id);
        socket.join(customId);
      }
    });

    // WebRTC Signaling Events
    if (this.io) {
      registerWebRTCRoutes(socket, this.io);
    }

    // WebRTC disconnect is handled by the video-call module
    socket.on("disconnect", (reason) => {
      console.info("[socket] disconnected", {
        socketId: socket.id,
        role: socket.userRole,
        reason,
      });
      for (const [userId, sockets] of this.users.entries()) {
        if (sockets.has(socket.id)) {
          sockets.delete(socket.id);
          if (sockets.size === 0) {
            this.users.delete(userId);
          }
        }
      }
    });
  }

  async emitNewBookingNotification(doctorId, bookingDetails) {
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
    let doctorSockets = this.users.get(doctorId.toString());

    // If not found, doctorId might be the Doctor profile ID while sockets are registered with SharedUser._id
    if (!doctorSockets || doctorSockets.size === 0) {
      try {
        const mongoose = (await import('mongoose')).default || await import('mongoose');
        const SharedUser = mongoose.model('SharedUser');
        const doctorUser = await SharedUser.findOne({ profileId: doctorId, role: 'doctor' });
        if (doctorUser) {
          doctorSockets = this.users.get(doctorUser._id.toString());
        }
      } catch (e) {
        console.error("[SocketService] Error resolving doctor SharedUser in emitNewBookingNotification:", e);
      }
    }

    if (doctorSockets && doctorSockets.size > 0) {
      for (const socketId of doctorSockets) {
        this.io.to(socketId).emit("new_booking", payload);
      }
    }

    // 2. Notify all connected admins
    this.io.to("admin_room").emit("new_booking", payload);
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

export { SocketService };
export const socketService = new SocketService();
