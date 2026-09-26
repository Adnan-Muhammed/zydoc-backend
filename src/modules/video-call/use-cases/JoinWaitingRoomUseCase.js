// src/modules/video-call/use-cases/JoinWaitingRoomUseCase.js
//
// Purpose: Handles the event when a PATIENT joins the waiting room for their
// upcoming appointment. This is the critical counterpart to ExtendRoomUseCase
// and is central to the race condition handling described in the spec.
//
// Key Responsibilities:
// 1. Register the patient in the waitingRoomParticipants map.
// 2. Check if the doctor is currently in an active (extended) call.
// 3. If so, recalculate the extension deadline — cap it to the next slot's
//    scheduled start time. 
// 4. Trigger the wrap-up countdown if we're already past the wrap-up trigger point.
// 5. Handle the race condition: If extend_call and join_waiting_room arrive at
//    the same millisecond, this handler writes to waitingRoomParticipants FIRST
//    (synchronously), so when ExtendRoomUseCase re-reads after its await, it
//    sees the updated state.

import {
  EARLY_JOIN_MINUTES,
  MAX_EXTENSION_MINUTES,
  WRAP_UP_COUNTDOWN_SECONDS,
  DEFAULT_BASE_DURATION_MINUTES,
} from '../../../config/videoCallConfig.js';
import {
  roomActiveParticipants,
  roomStartTimes,
  activeTimers,
  clearRoomTimers,
  roomState,
  waitingRoomParticipants,
} from './JoinRoomUseCase.js';

export class JoinWaitingRoomUseCase {
  constructor(signalingGateway, appointmentRepository) {
    this.signalingGateway = signalingGateway;
    this.appointmentRepository = appointmentRepository;
  }

  async execute(appointmentId, userId, role) {
    if (!appointmentId || !userId) return;

    const normalizedRole = role ? role.toLowerCase() : '';
    if (normalizedRole !== 'patient') return; // Only patients join the waiting room

    const waitingRoomKey = `waiting_${appointmentId}`;

    if (!this.appointmentRepository) return;

    try {
      const appointment = await this.appointmentRepository.findById(appointmentId);
      if (!appointment) return;

      const consultType = (appointment.consultationType || '').toLowerCase();
      if (consultType === 'offline' || consultType === 'physical') {
        waitingRoomParticipants.get(waitingRoomKey)?.delete(userId);
        return;
      }

      // Calculate scheduled start time
      let scheduledStartMs = 0;
      if (appointment.scheduledStartAt) {
        scheduledStartMs = new Date(appointment.scheduledStartAt).getTime();
      } else {
        const [timeStr, modifier] = (appointment.appointmentTime || '').trim().split(/\s+/);
        if (timeStr) {
          const scheduledStartDate = new Date(appointment.appointmentDate);
          let [hours, minutes] = timeStr.split(':').map(Number);
          if (modifier?.toUpperCase() === 'PM' && hours < 12) hours += 12;
          if (modifier?.toUpperCase() === 'AM' && hours === 12) hours = 0;
          scheduledStartDate.setHours(hours, minutes, 0, 0);
          scheduledStartMs = scheduledStartDate.getTime();
        }
      }

      const nowMs = Date.now();

      // Enforce EarlyJoinAt (ScheduledStartAt - 10 minutes)
      if (scheduledStartMs > 0 && nowMs < scheduledStartMs - EARLY_JOIN_MINUTES * 60000) {
        const earlyJoinTime = new Date(scheduledStartMs - EARLY_JOIN_MINUTES * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const errMsg = { message: `The waiting room opens 10 minutes before the scheduled time (at ${earlyJoinTime}).` };
        if (this.signalingGateway.socket?.id) this.signalingGateway.emitToSocket(this.signalingGateway.socket.id, "call_error", errMsg);
        waitingRoomParticipants.get(waitingRoomKey)?.delete(userId);
        return;
      }

      // ──────────────────────────────────────────────────────────────────────────
      // STEP 1: Register patient in waitingRoomParticipants (SYNCHRONOUS)
      // ──────────────────────────────────────────────────────────────────────────
      if (!waitingRoomParticipants.has(waitingRoomKey)) {
        waitingRoomParticipants.set(waitingRoomKey, new Map());
      }
      waitingRoomParticipants.get(waitingRoomKey).set(userId, this.signalingGateway.socket?.id);

      console.log(`[JoinWaitingRoomUseCase] Patient ${userId} joined waiting room for appointment ${appointmentId}.`);

      const doctorId = appointment.doctorId?.toString();
      if (!doctorId) return;

      // ──────────────────────────────────────────────────────────────────────
      // STEP 2: Notify the doctor immediately that a patient has arrived/is waiting (Rule 1)
      // ──────────────────────────────────────────────────────────────────────
      try {
        const mongoose = await import('mongoose');
        const SharedUser = mongoose.model('SharedUser');
        const patientUser = await SharedUser.findById(userId).populate('profileId');
        const pProfile = patientUser?.profileId || {};
        const patientName = `${pProfile.firstName || ''} ${pProfile.lastName || ''}`.trim()
          || patientUser?.googleName || 'A patient';

        this.signalingGateway.emitToUser(doctorId, 'patient-arrived', {
          appointmentId,
          patientId: userId,
          patientName,
          patientType: appointment.patientType,
          appointmentTime: appointment.appointmentTime,
          appointmentDate: appointment.appointmentDate,
          bufferSeconds: 30,
          message: "Your patient has entered the waiting room.",
        });
      } catch (notifyErr) {
        console.warn('[JoinWaitingRoomUseCase] Error sending patient-arrived notification to doctor:', notifyErr);
      }

      // ──────────────────────────────────────────────────────────────────────────
      // STEP 3: Find the doctor's CURRENT active call (if any)
      // ──────────────────────────────────────────────────────────────────────────
      let doctorActiveRoomId = null;
      let doctorActiveAppointmentId = null;
      for (const [rId, participants] of roomActiveParticipants.entries()) {
        if (participants.has(doctorId)) {
          doctorActiveRoomId = rId;
          doctorActiveAppointmentId = rId.replace('video_', '');
          break;
        }
      }

      // If doctor is not in any active call, nothing further to adjust
      if (!doctorActiveRoomId) {
        console.log(`[JoinWaitingRoomUseCase] Doctor ${doctorId} is not in an active call. No active call timer adjustment needed.`);
        return;
      }

      if (!scheduledStartMs) return;

      // Check if the doctor's currently active consultation is extended
      let isCallExtended = false;
      const activeRoomState = roomState.get(doctorActiveRoomId);
      if (activeRoomState?.extensionDeadlineMs) {
        isCallExtended = true;
      } else {
        try {
          const currentActiveAppointment = await this.appointmentRepository.findById(doctorActiveAppointmentId);
          if (currentActiveAppointment?.isExtended) {
            isCallExtended = true;
          }
        } catch (e) {
          console.warn('[JoinWaitingRoomUseCase] Error checking appointment extension status:', e);
        }
      }

      // ──────────────────────────────────────────────────────────────────────
      // STEP 4: Rule 2 & 2.1 Server-Side Auto-Cut Handling
      // ──────────────────────────────────────────────────────────────────────
      // Case A: Patient B goes live AT or AFTER their scheduled start time (Rule 2)
      //         OR Doctor's active call is already EXTENDED (extend is ON)
      // -> Immediately initiate 20-second auto-cut countdown on Doctor's active call.
      if (nowMs >= scheduledStartMs || isCallExtended) {
        const activeState = roomState.get(doctorActiveRoomId) || { wrapUpTriggered: false };
        if (!activeState.wrapUpTriggered) {
          activeState.wrapUpTriggered = true;
          activeState.nextPatientAppointmentId = appointmentId;
          activeState.nextPatientWaitingSlotMs = scheduledStartMs;
          roomState.set(doctorActiveRoomId, activeState);

          console.log(`[JoinWaitingRoomUseCase] Patient B went live (scheduledStartMs: ${new Date(scheduledStartMs).toISOString()}, isCallExtended: ${isCallExtended}). Triggering ${WRAP_UP_COUNTDOWN_SECONDS}s auto-cut in ${doctorActiveRoomId}.`);

          const timers = activeTimers.get(doctorActiveRoomId) || {};
          if (timers.wrapUpTimeout) clearTimeout(timers.wrapUpTimeout);
          if (timers.endCallTimeout) clearTimeout(timers.endCallTimeout);

          this.signalingGateway.broadcastToRoom(doctorActiveRoomId, 'server_wrap_up_warning', {
            reason: 'next_patient_live',
            remainingSeconds: WRAP_UP_COUNTDOWN_SECONDS,
            patientName,
            appointmentTime: appointment.appointmentTime,
            appointmentId,
            isNextPatientWaiting: true,
          });

          timers.endCallTimeout = setTimeout(async () => {
            console.log(`[JoinWaitingRoomUseCase] Auto-cut countdown completed for room ${doctorActiveRoomId}. Auto-terminating.`);
            this.signalingGateway.broadcastToRoom(doctorActiveRoomId, 'force_end_call', {
              reason: 'next_patient_live',
              appointmentId,
              patientName,
            });
            clearRoomTimers(doctorActiveRoomId);
            roomState.delete(doctorActiveRoomId);

            try {
              const AppointmentModel = mongoose.model('Appointment');
              await AppointmentModel.updateOne({ _id: doctorActiveAppointmentId }, { status: 'completed' });
            } catch (e) {
              console.error('[JoinWaitingRoomUseCase] Error marking appointment completed:', e);
            }
          }, WRAP_UP_COUNTDOWN_SECONDS * 1000);

          activeTimers.set(doctorActiveRoomId, timers);
        }
      } else {
        // Case B: Patient B joined early and call is NOT extended (still in normal base duration).
        // Register constraint so the continuous room evaluator triggers the 20s auto-cut at exact scheduled start.
        const state = roomState.get(doctorActiveRoomId);
        if (!state) {
          roomState.set(doctorActiveRoomId, {
            wrapUpTriggered: false,
            extensionDeadlineMs: null,
            nextPatientWaitingSlotMs: scheduledStartMs,
            nextPatientAppointmentId: appointmentId,
          });
        } else {
          if (!state.nextPatientWaitingSlotMs || scheduledStartMs < state.nextPatientWaitingSlotMs) {
            state.nextPatientWaitingSlotMs = scheduledStartMs;
            state.nextPatientAppointmentId = appointmentId;
          }
        }
      }
    } catch (err) {
      console.error('[JoinWaitingRoomUseCase] Error:', err);
    }
  }
}
