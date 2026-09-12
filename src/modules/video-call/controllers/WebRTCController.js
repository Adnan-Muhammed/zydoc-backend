import { SignalingGateway } from '../repositories/SignalingGateway.js';
import { JoinRoomUseCase } from '../use-cases/JoinRoomUseCase.js';
import { RelaySignalUseCase } from '../use-cases/RelaySignalUseCase.js';
import { LeaveRoomUseCase } from '../use-cases/LeaveRoomUseCase.js';
import { EndRoomUseCase } from '../use-cases/EndRoomUseCase.js';
import { ExtendRoomUseCase } from '../use-cases/ExtendRoomUseCase.js';
import { JoinWaitingRoomUseCase } from '../use-cases/JoinWaitingRoomUseCase.js';
import { waitingRoomParticipants, roomState, activeTimers, clearRoomTimers } from '../use-cases/JoinRoomUseCase.js';
import { WRAP_UP_COUNTDOWN_SECONDS } from '../../../config/videoCallConfig.js';
import { MongoAppointmentRepository } from '../../../infrastructure/repositories/MongoAppointmentRepository.js';
import { MongoTransactionRepository } from '../../../infrastructure/repositories/MongoTransactionRepository.js';

let isEvaluatorRunning = false;

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

    socket.on("end_call", async ({ appointmentId } = {}, callback) => {
      console.log(`[WebRTCController] Received end_call for appointment: ${appointmentId} from user ${socket.userId} (${socket.userRole})`);
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
      leaveRoom.execute(roomId, socket.userRole, socket.userId, socket.id);
    });

    // ── Consultation Hub Real-time Sync ─────────────────────────────────────
    socket.on("consultation-chat-message", (payload) => {
      const roomId = payload?.appointmentId ? `video_${payload.appointmentId}` : socket.currentVideoRoom;
      if (roomId) {
        socket.to(roomId).emit("consultation-chat-message", payload);
      }
    });

    socket.on("consultation-rx-updated", (payload) => {
      const roomId = payload?.appointmentId ? `video_${payload.appointmentId}` : socket.currentVideoRoom;
      if (roomId) {
        socket.to(roomId).emit("consultation-rx-updated", payload);
      }
    });

    socket.on("consultation-file-uploaded", (payload) => {
      const roomId = payload?.appointmentId ? `video_${payload.appointmentId}` : socket.currentVideoRoom;
      if (roomId) {
        socket.to(roomId).emit("consultation-file-uploaded", payload);
      }
    });

    // Handle peer disconnect for WebRTC specific cleanup
    socket.on("disconnect", () => {
      // For edge case: if they close the tab, LeaveRoomUseCase handles it
      leaveRoom.execute(socket.currentVideoRoom, socket.userRole, socket.userId, socket.id);
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
              remainingSeconds: WRAP_UP_COUNTDOWN_SECONDS
            });

            // Schedule strict hard-cutoff
            timers.endCallTimeout = setTimeout(async () => {
               console.log(`[TimerEvaluator] Wrap-up finished. Auto-terminating room ${roomId}.`);
               io.to(roomId).emit('force_end_call', { reason: 'override_timeout' });
               clearRoomTimers(roomId);
               roomState.delete(roomId);
               
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
    }, 2000); // Check every 2 seconds for high precision
  }
}
