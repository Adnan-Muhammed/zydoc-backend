import { SignalingGateway } from '../repositories/SignalingGateway.js';
import { JoinRoomUseCase } from '../use-cases/JoinRoomUseCase.js';
import { RelaySignalUseCase } from '../use-cases/RelaySignalUseCase.js';
import { LeaveRoomUseCase } from '../use-cases/LeaveRoomUseCase.js';
import { EndRoomUseCase } from '../use-cases/EndRoomUseCase.js';
import { ExtendRoomUseCase } from '../use-cases/ExtendRoomUseCase.js';
import { JoinWaitingRoomUseCase } from '../use-cases/JoinWaitingRoomUseCase.js';
import { waitingRoomParticipants, roomState, activeTimers, clearRoomTimers } from '../use-cases/JoinRoomUseCase.js';
import { WRAP_UP_COUNTDOWN_SECONDS, RECONNECTION_GRACE_SECONDS } from '../../../config/videoCallConfig.js';
import { MongoAppointmentRepository } from '../../../infrastructure/repositories/MongoAppointmentRepository.js';
import { MongoTransactionRepository } from '../../../infrastructure/repositories/MongoTransactionRepository.js';

let isEvaluatorRunning = false;
// Map to track temporary participant disconnects: key: `${roomId}_${userId}` -> { timeoutId, disconnectedAt }
const disconnectionGraceTimers = new Map();

// Map to track active in-session consultation data per roomId:
// key: `${roomId}` -> { messages: [], prescriptions: [], files: [] }
export const consultationSessionData = new Map();

export class WebRTCController { 
  static handle(socket, io) {
    if (!isEvaluatorRunning) {
      isEvaluatorRunning = true;
      this.startContinuousRoomEvaluator(io);
    }

    const gateway = new SignalingGateway(socket, io);
    const appointmentRepository = new MongoAppointmentRepository();
    const transactionRepository = new MongoTransactionRepository();
    const joinRoom = new JoinRoomUseCase(gateway, appointmentRepository);
    const relaySignal = new RelaySignalUseCase(gateway);
    const leaveRoom = new LeaveRoomUseCase(gateway, appointmentRepository);
    const endRoom = new EndRoomUseCase(gateway, appointmentRepository, transactionRepository);
    // ExtendRoomUseCase now needs appointmentRepository to check waiting room presence
    // and calculate extension deadlines (Condition A vs Condition B)
    const extendRoom = new ExtendRoomUseCase(gateway, appointmentRepository);
    const joinWaitingRoom = new JoinWaitingRoomUseCase(gateway, appointmentRepository);

    const getOrCreateConsultationSession = async (roomId, appointmentId) => {
      if (!consultationSessionData.has(roomId)) {
        consultationSessionData.set(roomId, {
          messages: [],
          prescriptions: [],
          files: [],
        });
      }
      const session = consultationSessionData.get(roomId);

      // Seed from database if in-memory prescriptions or files are empty
      if (session.prescriptions.length === 0 || session.files.length === 0) {
        try {
          const cleanId = appointmentId || roomId.replace('video_', '');
          if (cleanId) {
            const appointment = await appointmentRepository.findById(cleanId);
            if (appointment) {
              if (session.prescriptions.length === 0 && Array.isArray(appointment.prescriptions) && appointment.prescriptions.length > 0) {
                session.prescriptions = appointment.prescriptions;
              }
              if (session.files.length === 0 && Array.isArray(appointment.consultationFiles) && appointment.consultationFiles.length > 0) {
                session.files = appointment.consultationFiles;
              }

              // Check ConsultationRecord if still empty
              if (session.prescriptions.length === 0 || session.files.length === 0) {
                const mongoose = (await import('mongoose')).default || (await import('mongoose'));
                const ConsultationRecord = mongoose.models.ConsultationRecord || mongoose.model('ConsultationRecord');
                const cr = await ConsultationRecord.findOne({ appointmentId: cleanId }).lean();
                if (cr) {
                  if (session.prescriptions.length === 0 && Array.isArray(cr.prescriptions) && cr.prescriptions.length > 0) {
                    session.prescriptions = cr.prescriptions;
                  }
                  if (session.files.length === 0 && Array.isArray(cr.consultationFiles) && cr.consultationFiles.length > 0) {
                    session.files = cr.consultationFiles;
                  }
                }
              }
            }
          }
        } catch (err) {
          console.warn("[WebRTCController] Error seeding consultation session from DB:", err);
        }
      }

      return session;
    };

    const sendConsultationSync = async (roomId, appointmentId) => {
      try {
        const session = await getOrCreateConsultationSession(roomId, appointmentId);
        socket.emit("consultation-session-sync", {
          appointmentId: appointmentId || roomId.replace('video_', ''),
          messages: session.messages || [],
          prescriptions: session.prescriptions || [],
          files: session.files || [],
        });
      } catch (err) {
        console.warn("[WebRTCController] Error sending consultation sync:", err);
      }
    };

    socket.on("register", () => {
      // Cryptographically verified identity is established exclusively via handshake JWT.
      // Client-supplied payload is safely ignored to prevent role/identity spoofing.
      if (socket.userId) {
        socket.join(socket.userId);
      }
    });

    socket.on("join_room", async ({ appointmentId }) => {
      const roomId = appointmentId ? `video_${appointmentId}` : socket.currentVideoRoom;
      const userKey = `${roomId}_${socket.userId}`;

      // Rule 6: Check if user is reconnecting within the 30-second grace buffer
      if (disconnectionGraceTimers.has(userKey)) {
        console.log(`[WebRTCController] User ${socket.userId} reconnected to ${roomId} within ${RECONNECTION_GRACE_SECONDS}s grace window! Cancelling leave.`);
        const item = disconnectionGraceTimers.get(userKey);
        clearTimeout(item.timeoutId);
        disconnectionGraceTimers.delete(userKey);
      }

      // Also clean up any lingering timers for this room/user key
      for (const [key, item] of disconnectionGraceTimers.entries()) {
        if (key === userKey || (roomId && key.startsWith(`${roomId}_`) && (key.endsWith(`_${socket.userId}`) || !socket.userId))) {
          clearTimeout(item.timeoutId);
          disconnectionGraceTimers.delete(key);
        }
      }

      await joinRoom.execute(appointmentId, socket.userId, socket.userRole);

      // Rule 6: Immediately broadcast peer_reconnected to all participants in the room
      if (roomId) {
        io.to(roomId).emit("peer_reconnected", {
          userId: socket.userId,
          userRole: socket.userRole,
        });
      }

      // Ensure reconnecting participant receives all in-session consultation data
      if (roomId) {
        await sendConsultationSync(roomId, appointmentId);
      }
    });

    socket.on("request_consultation_sync", async ({ appointmentId }) => {
      const roomId = appointmentId ? `video_${appointmentId}` : socket.currentVideoRoom;
      if (roomId) {
        await sendConsultationSync(roomId, appointmentId);
      }
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

    socket.on("end_call", async ({ appointmentId } = {}, callback) => {
      console.log(`[WebRTCController] Received end_call for appointment: ${appointmentId} from user ${socket.userId} (${socket.userRole})`);
      const roomId = appointmentId ? `video_${appointmentId}` : socket.currentVideoRoom;
      if (roomId) {
        consultationSessionData.delete(roomId);
      }
      try {
        await endRoom.execute(appointmentId, socket.userId, socket.userRole);
        if (typeof callback === "function") callback({ success: true });
      } catch (err) {
        console.error("[WebRTCController] Error in end_call:", err);
        if (typeof callback === "function") callback({ error: err?.message });
      }
    });

    socket.on("extend_call", ({ appointmentId }) => {
      extendRoom.execute(appointmentId, socket.userId, socket.userRole);
    });

    // ── Waiting Room Events ─────────────────────────────────────────────────
    // The patient emits join_waiting_room when they enter the waiting room UI.
    // This is separate from join_room (which enters the actual call).
    // The waiting room status is checked by ExtendRoomUseCase to determine
    // if the extension should be capped (Condition A vs Condition B).
    socket.on("join_waiting_room", ({ appointmentId }) => {
      joinWaitingRoom.execute(appointmentId, socket.userId, socket.userRole);
    });

    // Clean up waiting room presence when patient leaves
    socket.on("leave_waiting_room", ({ appointmentId }) => {
      // Note: Even if the patient leaves the waiting room during a wrap-up
      // countdown, the countdown is NOT reversed (Race Condition #2).
      // We only clean up the presence map here.
      if (appointmentId && socket.userId) {
        const waitingRoomKey = `waiting_${appointmentId}`;
        const participants = waitingRoomParticipants.get(waitingRoomKey);
        if (participants) {
          participants.delete(socket.userId);
          if (participants.size === 0) {
            waitingRoomParticipants.delete(waitingRoomKey);
          }
        }
      }
    });

    socket.on("leave_room", ({ appointmentId } = {}) => {
      const roomId = appointmentId ? `video_${appointmentId}` : socket.currentVideoRoom;
      const userKey = `${roomId}_${socket.userId}`;
      if (disconnectionGraceTimers.has(userKey)) {
        clearTimeout(disconnectionGraceTimers.get(userKey).timeoutId);
        disconnectionGraceTimers.delete(userKey);
      }
      leaveRoom.execute(roomId, socket.userRole, socket.userId, socket.id);
    });

    // ── Consultation Hub Real-time Sync & In-Session Data Preservation ────────
    socket.on("consultation-chat-message", async (payload) => {
      const roomId = payload?.appointmentId ? `video_${payload.appointmentId}` : socket.currentVideoRoom;
      if (roomId && payload) {
        const session = await getOrCreateConsultationSession(roomId, payload.appointmentId);
        if (payload.id) {
          const exists = session.messages.some((m) => m.id === payload.id);
          if (!exists) {
            session.messages.push(payload);
          }
        } else {
          session.messages.push(payload);
        }
        socket.to(roomId).emit("consultation-chat-message", payload);
      }
    });

    socket.on("consultation-rx-updated", async (payload) => {
      const roomId = payload?.appointmentId ? `video_${payload.appointmentId}` : socket.currentVideoRoom;
      if (roomId && payload) {
        const session = await getOrCreateConsultationSession(roomId, payload.appointmentId);
        if (Array.isArray(payload.prescriptions)) {
          session.prescriptions = payload.prescriptions;
        }
        socket.to(roomId).emit("consultation-rx-updated", payload);
      }
    });

    socket.on("consultation-file-uploaded", async (payload) => {
      const roomId = payload?.appointmentId ? `video_${payload.appointmentId}` : socket.currentVideoRoom;
      if (roomId && payload) {
        const session = await getOrCreateConsultationSession(roomId, payload.appointmentId);
        if (payload.file) {
          const exists = session.files.some(
            (f) => (f.id && f.id === payload.file.id) || (f.url && f.url === payload.file.url)
          );
          if (!exists) {
            session.files.unshift(payload.file);
          }
        }
        socket.to(roomId).emit("consultation-file-uploaded", payload);
      }
    });

    // Handle peer disconnect for WebRTC with Rule 6: 30-Second Reconnection Grace Buffer
    socket.on("disconnect", () => {
      const roomId = socket.currentVideoRoom;
      const userId = socket.userId;
      const userRole = socket.userRole;
      const socketId = socket.id;

      if (!roomId || !userId) return;

      console.log(`[WebRTCController] User ${userId} (${userRole}) disconnected from ${roomId}. Starting ${RECONNECTION_GRACE_SECONDS}s reconnection grace buffer...`);

      // Notify other participant in the room that peer connection dropped temporarily
      socket.to(roomId).emit("peer_temporarily_disconnected", {
        userId,
        userRole,
        gracePeriodSeconds: RECONNECTION_GRACE_SECONDS,
      });

      const userKey = `${roomId}_${userId}`;
      if (disconnectionGraceTimers.has(userKey)) {
        clearTimeout(disconnectionGraceTimers.get(userKey).timeoutId);
      }

      const timeoutId = setTimeout(() => {
        disconnectionGraceTimers.delete(userKey);
        console.log(`[WebRTCController] Reconnection grace period expired (${RECONNECTION_GRACE_SECONDS}s) for user ${userId} in ${roomId}. Executing full room leave.`);
        leaveRoom.execute(roomId, userRole, userId, socketId);
      }, RECONNECTION_GRACE_SECONDS * 1000);

      disconnectionGraceTimers.set(userKey, { timeoutId, disconnectedAt: Date.now() });
    });

  }

  static startContinuousRoomEvaluator(io) {
    setInterval(async () => {
      const nowMs = Date.now();
      for (const [roomId, state] of roomState.entries()) {
        if (state.wrapUpTriggered) continue; // Already in wrap-up

        // Check if we have a next patient waiting
        const nextApptId = state.nextPatientAppointmentId;
        if (!nextApptId) continue;

        const waitingKey = `waiting_${nextApptId}`;
        const waitingGroup = waitingRoomParticipants.get(waitingKey);
        
        // 1. Are they currently in the waiting room?
        if (waitingGroup && waitingGroup.size > 0) {
          // 2. Has their exact scheduled time arrived?
          if (state.nextPatientWaitingSlotMs && nowMs >= state.nextPatientWaitingSlotMs) {
            
            console.log(`[TimerEvaluator] OVERRIDE: Room ${roomId} exceeded next patient's time. Intercepting...`);
            
            state.wrapUpTriggered = true;
            
            // Clear normal extension timers
            const timers = activeTimers.get(roomId) || {};
            if (timers.wrapUpTimeout) clearTimeout(timers.wrapUpTimeout);
            if (timers.endCallTimeout) clearTimeout(timers.endCallTimeout);

            // Emit real-time override — reuse 'server_wrap_up_warning' so the
            // existing VideoCallRoom.tsx listener handles it without any change.
            io.to(roomId).emit('server_wrap_up_warning', {
              reason: 'next_patient_time_reached',
              remainingSeconds: WRAP_UP_COUNTDOWN_SECONDS,
              appointmentId: nextApptId,
              isNextPatientWaiting: true,
            });

            // Schedule strict hard-cutoff
            timers.endCallTimeout = setTimeout(async () => {
               console.log(`[TimerEvaluator] Wrap-up finished. Auto-terminating room ${roomId}.`);
               io.to(roomId).emit('force_end_call', {
                 reason: 'next_patient_live',
                 appointmentId: nextApptId,
               });
               clearRoomTimers(roomId);
               roomState.delete(roomId);
               consultationSessionData.delete(roomId);
               
               // Update DB
               try {
                  const mongoose = await import('mongoose');
                  const AppointmentModel = mongoose.model('Appointment');
                  await AppointmentModel.updateOne({ _id: roomId.replace('video_', '') }, { status: 'completed' });
               } catch (e) {}
            }, WRAP_UP_COUNTDOWN_SECONDS * 1000);
            
            activeTimers.set(roomId, timers);
          }
        }
      }
    }, 1000); // Check every second for exact precision with the 20-second auto-cut standard
  }
}
