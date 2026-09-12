// src/modules/video-call/use-cases/ExtendRoomUseCase.js
//
// Purpose: Handles the doctor's "Extend Call" action. This is the most critical
// use case for the timer system. It must:
//
// 1. Validate that only a doctor can extend.
// 2. Check the waiting room for the NEXT patient's presence.
// 3. Calculate the extension deadline:
//    - Condition A: Next patient IS waiting → deadline = nextSlotStartTime
//    - Condition B: Next patient NOT waiting → deadline = sessionStart + baseDuration + MAX_EXTENSION_MINUTES
// 4. Schedule server-side wrap-up + auto-cut timers.
// 5. Handle race conditions: Re-read waiting room state AFTER any async operation.
// 6. Emit extension_granted to the room.
//
// Race Condition Handling (Section 4 of Spec):
// ─────────────────────────────────────────────
// If the doctor clicks "Extend" at the exact millisecond the next patient clicks
// "Join Waiting Room":
//   - Node.js event loop processes one event first.
//   - If join_waiting_room runs first: waitingRoomParticipants is already updated
//     synchronously. When this handler resumes after its `await`, it reads the
//     updated state → Condition A applies.
//   - If extend_call runs first: This handler does `await findById()` (yields control).
//     During that yield, join_waiting_room runs and updates waitingRoomParticipants.
//     When this handler resumes, it re-reads waitingRoomParticipants → Condition A.
//
// In both cases, the waiting room status wins. ✅

import Appointment from '../../../infrastructure/database/models/Appointment.js';
import {
  MAX_EXTENSION_MINUTES,
  WRAP_UP_COUNTDOWN_SECONDS,
  DEFAULT_BASE_DURATION_MINUTES,
} from '../../../config/videoCallConfig.js';
import {
  roomStartTimes,
  roomActiveParticipants,
  activeTimers,
  clearRoomTimers,
  roomState,
  waitingRoomParticipants,
} from './JoinRoomUseCase.js';

export class ExtendRoomUseCase {
  constructor(signalingGateway, appointmentRepository) {
    this.signalingGateway = signalingGateway;
    this.appointmentRepository = appointmentRepository;
  }

  async execute(appointmentId, userId, userRole) {
    if (!appointmentId) return;

    const normalizedRole = userRole ? userRole.toLowerCase() : '';
    if (normalizedRole !== 'doctor') return; // Only doctors can extend

    const roomId = `video_${appointmentId}`;

    // ──────────────────────────────────────────────────────────────────────────
    // GUARD: Check if wrap-up has already been triggered (irreversible)
    // (Race Condition #2: once wrap-up starts, no extension can be granted)
    // ──────────────────────────────────────────────────────────────────────────
    const currentState = roomState.get(roomId);
    if (currentState?.wrapUpTriggered) {
      console.log(`[ExtendRoomUseCase] Wrap-up already triggered for room ${roomId}. Extension denied.`);
      this.signalingGateway.broadcastToRoom(roomId, 'extension_denied', {
        reason: 'wrap_up_in_progress',
        message: 'Cannot extend — wrap-up countdown is already active.',
      });
      return;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: Fetch appointment data (ASYNC — yields event loop control)
    //
    // ⚠️  CRITICAL: After this await, join_waiting_room may have processed.
    //     We MUST re-read waitingRoomParticipants AFTER this point.
    // ──────────────────────────────────────────────────────────────────────────
    try {
      const appointment = await this.appointmentRepository
        ? await this.appointmentRepository.findById(appointmentId)
        : await Appointment.findById(appointmentId);

      if (!appointment) {
        console.error(`[ExtendRoomUseCase] Appointment ${appointmentId} not found.`);
        return;
      }

      // Check if already extended
      if (appointment.isExtended) {
        console.log(`[ExtendRoomUseCase] Appointment ${appointmentId} already extended. Ignoring duplicate.`);
        return;
      }

      // ────────────────────────────────────────────────────────────────────────
      // STEP 2: Calculate base duration end time
      // ────────────────────────────────────────────────────────────────────────
      const sessionStartedAt = roomStartTimes.get(appointmentId);
      if (!sessionStartedAt) {
        console.error(`[ExtendRoomUseCase] No session start time found for appointment ${appointmentId}.`);
        return;
      }

      const sessionStartMs = new Date(sessionStartedAt).getTime();

      let baseDurationMinutes = DEFAULT_BASE_DURATION_MINUTES;
      if (appointment.scheduledStartAt && appointment.scheduledEndAt) {
        const diffMins = Math.round(
          (new Date(appointment.scheduledEndAt).getTime() -
            new Date(appointment.scheduledStartAt).getTime()) / 60000
        );
        if (diffMins > 0) baseDurationMinutes = diffMins;
      }

      const baseDurationEndMs = sessionStartMs + (baseDurationMinutes * 60000);

      // ────────────────────────────────────────────────────────────────────────
      // STEP 3: Find the next appointment for this doctor
      // ────────────────────────────────────────────────────────────────────────
      const mongoose = await import('mongoose');
      const AppointmentModel = mongoose.model('Appointment');

      const upcomingAppointments = await AppointmentModel.find({
        doctorId: appointment.doctorId,
        appointmentDate: appointment.appointmentDate,
        status: { $in: ['scheduled', 'locked'] },
        _id: { $ne: appointmentId },
      });

      let nextSlotStartMs = null;
      let nextAppointmentId = null;

      for (const app of upcomingAppointments) {
        let appStartMs = null;

        if (app.scheduledStartAt) {
          appStartMs = new Date(app.scheduledStartAt).getTime();
        } else {
          const [timeStr, modifier] = (app.appointmentTime || '').trim().split(/\s+/);
          if (timeStr) {
            const appStartDate = new Date(appointment.appointmentDate);
            let [hours, minutes] = timeStr.split(':').map(Number);
            if (modifier?.toUpperCase() === 'PM' && hours < 12) hours += 12;
            if (modifier?.toUpperCase() === 'AM' && hours === 12) hours = 0;
            appStartDate.setHours(hours, minutes, 0, 0);
            appStartMs = appStartDate.getTime();
          }
        }

        if (appStartMs && appStartMs > baseDurationEndMs) {
          if (!nextSlotStartMs || appStartMs < nextSlotStartMs) {
            nextSlotStartMs = appStartMs;
            nextAppointmentId = app._id?.toString();
          }
        }
      }

      // ────────────────────────────────────────────────────────────────────────
      // STEP 4: Check waiting room presence for the next patient
      //
      // ⚠️  CRITICAL RACE CONDITION POINT: We read waitingRoomParticipants
      //     AFTER the awaits above. If join_waiting_room processed during our
      //     awaits, we will see the updated state here.
      //
      //     Also check roomState.nextPatientWaitingSlotMs which is set
      //     synchronously by JoinWaitingRoomUseCase.
      // ────────────────────────────────────────────────────────────────────────
      let isNextPatientWaiting = false;
      let constrainedDeadlineMs = null;

      // Check 1: Is the next patient in the waiting room participants map?
      if (nextAppointmentId) {
        const waitingRoomKey = `waiting_${nextAppointmentId}`;
        const waitingParticipants = waitingRoomParticipants.get(waitingRoomKey);
        if (waitingParticipants && waitingParticipants.size > 0) {
          isNextPatientWaiting = true;
          // IMPORTANT: Set deadline to 60s PAST the start time, so that the 60s wrap-up
          // triggers EXACTLY at the next slot's start time!
          constrainedDeadlineMs = nextSlotStartMs + (WRAP_UP_COUNTDOWN_SECONDS * 1000);
        }
      }

      // Check 2: Did JoinWaitingRoomUseCase set a constraint on this room's state?
      const roomCurrentState = roomState.get(roomId);
      if (roomCurrentState?.nextPatientWaitingSlotMs) {
        isNextPatientWaiting = true;
        const stateConstraint = roomCurrentState.nextPatientWaitingSlotMs;
        if (!constrainedDeadlineMs || stateConstraint < constrainedDeadlineMs) {
          constrainedDeadlineMs = stateConstraint;
        }
      }

      // Check 3: Is the next patient already in ANY room (joined early)?
      if (nextAppointmentId && !isNextPatientWaiting) {
        const nextRoomId = `video_${nextAppointmentId}`;
        const nextRoomParticipants = roomActiveParticipants.get(nextRoomId);
        if (nextRoomParticipants && nextRoomParticipants.size > 0) {
          isNextPatientWaiting = true;
          constrainedDeadlineMs = nextSlotStartMs + (WRAP_UP_COUNTDOWN_SECONDS * 1000);
        }
      }

      // ────────────────────────────────────────────────────────────────────────
      // STEP 5: Calculate extension deadline
      //
      // Condition A: Next patient IS waiting
      //   → deadline = nextSlotStartMs (capped by their scheduled time)
      //
      // Condition B: Next patient NOT waiting
      //   → deadline = baseDurationEndMs + MAX_EXTENSION_MINUTES * 60000
      //
      // In both cases, the deadline is also capped by the absolute maximum
      // (baseDurationEnd + MAX_EXTENSION_MINUTES).
      // ────────────────────────────────────────────────────────────────────────
      const maxExtensionMs = MAX_EXTENSION_MINUTES * 60000;
      const absoluteMaxDeadlineMs = baseDurationEndMs + maxExtensionMs;

      let extensionDeadlineMs;

      if (isNextPatientWaiting && constrainedDeadlineMs) {
        // Condition A: Cap by next patient's slot start time
        extensionDeadlineMs = Math.min(constrainedDeadlineMs, absoluteMaxDeadlineMs);
        console.log(`[ExtendRoomUseCase] Condition A: Next patient is waiting. Extension capped to ${new Date(extensionDeadlineMs).toISOString()}.`);
      } else {
        // Condition B: Full extension allowed
        extensionDeadlineMs = absoluteMaxDeadlineMs;
        console.log(`[ExtendRoomUseCase] Condition B: No next patient waiting. Full extension to ${new Date(extensionDeadlineMs).toISOString()}.`);
      }

      // ────────────────────────────────────────────────────────────────────────
      // STEP 6: Mark appointment as extended in DB
      // ────────────────────────────────────────────────────────────────────────
      await AppointmentModel.findOneAndUpdate(
        { _id: appointmentId },
        {
          $set: {
            isExtended: true,
            extensionDeadlineAt: new Date(extensionDeadlineMs),
            extensionConstrainedByNextPatient: isNextPatientWaiting,
          },
        },
        { new: true }
      );

      // ────────────────────────────────────────────────────────────────────────
      // STEP 7: Update room state
      // ────────────────────────────────────────────────────────────────────────
      if (!roomState.has(roomId)) {
        roomState.set(roomId, {
          wrapUpTriggered: false,
          extensionDeadlineMs,
          nextPatientWaitingSlotMs: nextSlotStartMs, // Store the raw start time for the Evaluator
          nextPatientAppointmentId: nextAppointmentId,
        });
      } else {
        const state = roomState.get(roomId);
        state.extensionDeadlineMs = extensionDeadlineMs;
        state.nextPatientAppointmentId = nextAppointmentId;
        state.nextPatientWaitingSlotMs = nextSlotStartMs;
      }

      // ────────────────────────────────────────────────────────────────────────
      // STEP 8: Schedule server-side wrap-up + auto-cut timers
      //
      // The wrap-up warning fires WRAP_UP_COUNTDOWN_SECONDS before the deadline.
      // The force_end_call fires exactly at the deadline.
      //
      // These are server-side enforcers — they will terminate the call even if
      // the client's timer is lagging due to network issues.
      // (Race Condition #3: Server-Side Enforcement)
      // ────────────────────────────────────────────────────────────────────────
      const nowMs = Date.now();

      // Clear any existing extension-specific timers (but keep hardLimitTimeout)
      const existingTimers = activeTimers.get(roomId) || {};
      if (existingTimers.wrapUpTimeout) clearTimeout(existingTimers.wrapUpTimeout);
      if (existingTimers.endCallTimeout) clearTimeout(existingTimers.endCallTimeout);

      const wrapUpTriggerMs = extensionDeadlineMs - (WRAP_UP_COUNTDOWN_SECONDS * 1000);
      const delayUntilWrapUp = Math.max(0, wrapUpTriggerMs - nowMs);

      const timers = activeTimers.get(roomId) || {};

      if (nowMs >= wrapUpTriggerMs) {
        // We're already past the wrap-up trigger point — start immediately
        const state = roomState.get(roomId);
        state.wrapUpTriggered = true;

        const remainingUntilDeadline = Math.max(1, Math.ceil((extensionDeadlineMs - nowMs) / 1000));

        console.log(`[ExtendRoomUseCase] Already past wrap-up trigger. Starting ${remainingUntilDeadline}s wrap-up NOW.`);

        this.signalingGateway.broadcastToRoom(roomId, 'server_wrap_up_warning', {
          remainingSeconds: remainingUntilDeadline,
        });

        timers.endCallTimeout = setTimeout(async () => {
          console.log(`[ExtendRoomUseCase] Wrap-up completed for room ${roomId}. Auto-terminating.`);
          this.signalingGateway.broadcastToRoom(roomId, 'force_end_call', {
            reason: isNextPatientWaiting ? 'next_patient_waiting' : 'max_extension_reached',
          });
          try {
            await AppointmentModel.updateOne({ _id: appointmentId }, { status: 'completed' });
          } catch (e) { /* swallow */ }
          clearRoomTimers(roomId);
          roomState.delete(roomId);
        }, remainingUntilDeadline * 1000);
      } else {
        // Schedule wrap-up for the future
        console.log(`[ExtendRoomUseCase] Scheduling wrap-up in ${Math.round(delayUntilWrapUp / 1000)}s.`);

        timers.wrapUpTimeout = setTimeout(() => {
          const state = roomState.get(roomId);

          // ── Wrap-Up Irreversibility Check ──────────────────────────────
          // (Race Condition #2): Once wrapUpTriggered is set, it CANNOT be
          // reversed, even if the next patient leaves the waiting room.
          // ────────────────────────────────────────────────────────────────
          if (state?.wrapUpTriggered) return;
          state.wrapUpTriggered = true;

          console.log(`[ExtendRoomUseCase] Wrap-up triggered for room ${roomId}.`);

          this.signalingGateway.broadcastToRoom(roomId, 'server_wrap_up_warning', {
            remainingSeconds: WRAP_UP_COUNTDOWN_SECONDS,
          });

          timers.endCallTimeout = setTimeout(async () => {
            console.log(`[ExtendRoomUseCase] Wrap-up completed for room ${roomId}. Auto-terminating.`);
            this.signalingGateway.broadcastToRoom(roomId, 'force_end_call', {
              reason: isNextPatientWaiting ? 'next_patient_waiting' : 'max_extension_reached',
            });
            try {
              await AppointmentModel.updateOne({ _id: appointmentId }, { status: 'completed' });
            } catch (e) { /* swallow */ }
            clearRoomTimers(roomId);
            roomState.delete(roomId);
          }, WRAP_UP_COUNTDOWN_SECONDS * 1000);
        }, delayUntilWrapUp);
      }

      activeTimers.set(roomId, timers);

      // ────────────────────────────────────────────────────────────────────────
      // STEP 9: Emit extension_granted to the room
      // ────────────────────────────────────────────────────────────────────────
      const extensionDurationSeconds = Math.max(0, Math.floor((extensionDeadlineMs - nowMs) / 1000));

      this.signalingGateway.broadcastToRoom(roomId, 'extension_granted', {
        extensionDeadlineMs,
        extensionDeadlineISO: new Date(extensionDeadlineMs).toISOString(),
        maxExtensionMinutes: MAX_EXTENSION_MINUTES,
        extensionDurationSeconds,
        isConstrainedByNextPatient: isNextPatientWaiting,
        wrapUpCountdownSeconds: WRAP_UP_COUNTDOWN_SECONDS,
      });

      console.log(`[ExtendRoomUseCase] Extension granted for appointment ${appointmentId}. Deadline: ${new Date(extensionDeadlineMs).toISOString()}, Constrained: ${isNextPatientWaiting}.`);

    } catch (err) {
      console.error('[ExtendRoomUseCase] Error extending the call:', err);
    }
  }
}
