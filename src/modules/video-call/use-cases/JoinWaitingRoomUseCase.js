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

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: Register patient in waitingRoomParticipants (SYNCHRONOUS)
    // ──────────────────────────────────────────────────────────────────────────
    // This MUST happen synchronously BEFORE any async operation so that a
    // concurrent extend_call handler (which does an await before checking)
    // will see this patient's presence.
    // ──────────────────────────────────────────────────────────────────────────
    if (!waitingRoomParticipants.has(waitingRoomKey)) {
      waitingRoomParticipants.set(waitingRoomKey, new Map());
    }
    waitingRoomParticipants.get(waitingRoomKey).set(userId, this.signalingGateway.socket?.id);

    console.log(`[JoinWaitingRoomUseCase] Patient ${userId} joined waiting room for appointment ${appointmentId}.`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2: Find the doctor's CURRENT active call (if any)
    // ──────────────────────────────────────────────────────────────────────────
    if (!this.appointmentRepository) return;

    try {
      const appointment = await this.appointmentRepository.findById(appointmentId);
      if (!appointment) return;

      const consultType = (appointment.consultationType || '').toLowerCase();
      if (consultType === 'offline' || consultType === 'physical') {
        waitingRoomParticipants.get(waitingRoomKey)?.delete(userId);
        return;
      }

      const doctorId = appointment.doctorId?.toString();
      if (!doctorId) return;

      // Find the room where the doctor is currently active
      let doctorActiveRoomId = null;
      let doctorActiveAppointmentId = null;
      for (const [rId, participants] of roomActiveParticipants.entries()) {
        if (participants.has(doctorId)) {
          doctorActiveRoomId = rId;
          doctorActiveAppointmentId = rId.replace('video_', '');
          break;
        }
      }

      // If doctor is not in any active call, nothing to do
      if (!doctorActiveRoomId) {
        console.log(`[JoinWaitingRoomUseCase] Doctor ${doctorId} is not in an active call. No timer adjustment needed.`);
        return;
      }

      // ──────────────────────────────────────────────────────────────────────
      // STEP 3: Notify the doctor that a patient is waiting
      // ──────────────────────────────────────────────────────────────────────
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
      });

      // ──────────────────────────────────────────────────────────────────────
      // STEP 4: Calculate the next slot's start time
      // ──────────────────────────────────────────────────────────────────────
      let nextSlotStartMs = null;
      if (appointment.scheduledStartAt) {
        nextSlotStartMs = new Date(appointment.scheduledStartAt).getTime();
      } else {
        const [timeStr, modifier] = (appointment.appointmentTime || '').trim().split(/\s+/);
        if (timeStr) {
          const scheduledStartDate = new Date(appointment.appointmentDate);
          let [hours, minutes] = timeStr.split(':').map(Number);
          if (modifier?.toUpperCase() === 'PM' && hours < 12) hours += 12;
          if (modifier?.toUpperCase() === 'AM' && hours === 12) hours = 0;
          scheduledStartDate.setHours(hours, minutes, 0, 0);
          nextSlotStartMs = scheduledStartDate.getTime();
        }
      }

      if (!nextSlotStartMs) return;

      // ──────────────────────────────────────────────────────────────────────
      // STEP 5: Update room state for the Continuous Evaluator
      // ──────────────────────────────────────────────────────────────────────
      // Instead of relying on one-off timeout calculations which cause race
      // conditions, we simply update the roomState. The Continuous Evaluator
      // running in WebRTCController will check this state every 2 seconds
      // and intercept the call exactly when nowMs >= nextSlotStartMs.

      // Bug fix: define `state` — was missing after refactor, causing ReferenceError
      const state = roomState.get(doctorActiveRoomId);

      if (!state) {
        roomState.set(doctorActiveRoomId, {
          wrapUpTriggered: false,
          extensionDeadlineMs: null, // Will be set by ExtendRoomUseCase if not already
          nextPatientWaitingSlotMs: nextSlotStartMs,
          nextPatientAppointmentId: appointmentId
        });
      } else {
        // Update the constraint: if a closer next patient appears, use their time
        if (!state.nextPatientWaitingSlotMs || nextSlotStartMs < state.nextPatientWaitingSlotMs) {
          state.nextPatientWaitingSlotMs = nextSlotStartMs;
          state.nextPatientAppointmentId = appointmentId;
        }
      }

      // If the call is ALREADY extended, we should notify the frontend so the
      // UI can display the orange constraint indicator ("⚠️ (next patient)")
      // Note: The actual forced termination will be handled by the Evaluator.
      const sessionStartedAt = roomStartTimes.get(doctorActiveAppointmentId);
      if (sessionStartedAt) {
        const currentActiveAppointment = await this.appointmentRepository.findById(doctorActiveAppointmentId);
        
        // Bug fix: Replace hardcoded '10' with config constant DEFAULT_BASE_DURATION_MINUTES
        let baseDurationMinutes = DEFAULT_BASE_DURATION_MINUTES;
        if (currentActiveAppointment && currentActiveAppointment.scheduledStartAt && currentActiveAppointment.scheduledEndAt) {
          const diffMins = Math.round(
            (new Date(currentActiveAppointment.scheduledEndAt).getTime() -
             new Date(currentActiveAppointment.scheduledStartAt).getTime()) / 60000
          );
          if (diffMins > 0) baseDurationMinutes = diffMins;
        }

        const baseDurationEndMs = new Date(sessionStartedAt).getTime() + (baseDurationMinutes * 60000);
        
        // Bug fix: define nowMs — was missing after refactor causing ReferenceError
        const nowMs = Date.now();
        
        if (nowMs >= baseDurationEndMs && currentActiveAppointment?.isExtended) {
          // Notify room about the new constraint so UI updates immediately
          // The actual deadline enforcement is left to the continuous evaluator.
          this.signalingGateway.broadcastToRoom(doctorActiveRoomId, 'extension_deadline_updated', {
            extensionDeadlineMs: nextSlotStartMs + (WRAP_UP_COUNTDOWN_SECONDS * 1000), 
            isConstrainedByNextPatient: true,
            remainingSeconds: Math.ceil(((nextSlotStartMs + (WRAP_UP_COUNTDOWN_SECONDS * 1000)) - nowMs) / 1000)
          });
        }
      }
    } catch (err) {
      console.error('[JoinWaitingRoomUseCase] Error:', err);
    }
  }
}
