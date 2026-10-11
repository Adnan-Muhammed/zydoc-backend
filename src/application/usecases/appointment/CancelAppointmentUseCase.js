import Appointment from '../../../infrastructure/database/models/Appointment.js';
import Transaction from '../../../infrastructure/database/models/Transaction.js';
import WalletTransaction from '../../../infrastructure/database/models/WalletTransaction.js';
import { getSlotExactUTC } from '../../../infrastructure/utils/timeUtils.js';

export class CancelAppointmentUseCase {
  constructor(creditWalletUseCase, createNotificationUseCase = null) {
    this.creditWalletUseCase = creditWalletUseCase;
    this.createNotificationUseCase = createNotificationUseCase;
  }

  async execute({ appointmentId, patientId, doctorId, userRole, reason }) {
    if (!appointmentId) throw new Error('appointmentId is required');

    let appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      const err = new Error('Appointment not found');
      err.statusCode = 404;
      throw err;
    }

    // Handle manual doctor bookings (no refund needed, zero commission)
    if (appointment.isManualBooking || appointment.bookedByDoctor) {
      const isDoctorOwner =
        (doctorId && appointment.doctorId?.toString() === doctorId.toString()) ||
        (patientId && appointment.doctorId?.toString() === patientId.toString()) ||
        userRole === 'doctor';

      if (!isDoctorOwner) {
        const err = new Error('You are not authorized to cancel this manual appointment.');
        err.statusCode = 403;
        throw err;
      }

      if (appointment.status !== 'scheduled') {
        const err = new Error(
          `Cannot cancel appointment with status '${appointment.status}'. Only 'scheduled' appointments can be cancelled.`
        );
        err.statusCode = 400;
        throw err;
      }

      // Do not allow cancelling if the appointment time has already passed
      const dateStr = appointment.appointmentDate
        ? new Date(appointment.appointmentDate).toISOString().split('T')[0]
        : null;
      const appointmentStartUTC = appointment.scheduledStartAt
        ? new Date(appointment.scheduledStartAt)
        : getSlotExactUTC(dateStr, appointment.appointmentTime, appointment.doctorTimezone || 'Asia/Kolkata');

      if (appointmentStartUTC && new Date().getTime() >= appointmentStartUTC.getTime()) {
        const err = new Error('Cannot cancel an appointment for a time that has already passed.');
        err.statusCode = 400;
        throw err;
      }

      appointment.status = 'cancelled_by_doctor';
      appointment.cancellationReason = reason || 'Cancelled by doctor';
      appointment.cancelledAt = new Date();
      appointment.lockedBy = undefined;
      appointment.lockExpiryTime = undefined;
      appointment.roomId = undefined;
      appointment.offlineOTP = undefined;
      appointment.lateJoinCutoffAt = undefined;
      await appointment.save();

      return {
        success: true,
        message: 'Manual appointment cancelled successfully. The slot is now free.',
        appointment,
      };
    }

    if (!patientId) throw new Error('patientId is required');

    // Only the patient who booked may cancel regular patient appointments
    if (appointment.patientId?.toString() !== patientId.toString()) {
      const err = new Error('You are not authorized to cancel this appointment.');
      err.statusCode = 403;
      throw err;
    }

    // Ineligible status checks (or already cancelled)
    if (appointment.status === 'cancelled' && appointment.paymentStatus === 'refunded') {
      const err = new Error(
        `Cannot cancel appointment with status '${appointment.status}'. Only 'scheduled' appointments can be cancelled.`
      );
      err.statusCode = 400;
      throw err;
    }

    if (appointment.status !== 'scheduled' && appointment.status !== 'refund_pending') {
      const err = new Error(
        `Cannot cancel appointment with status '${appointment.status}'. Only 'scheduled' appointments can be cancelled.`
      );
      err.statusCode = 400;
      throw err;
    }

    // Calculate appointment scheduled start time
    const dateStr = appointment.appointmentDate
      ? new Date(appointment.appointmentDate).toISOString().split('T')[0]
      : null;
    const appointmentStartUTC = appointment.scheduledStartAt
      ? new Date(appointment.scheduledStartAt)
      : getSlotExactUTC(dateStr, appointment.appointmentTime, appointment.doctorTimezone || 'Asia/Kolkata');

    const now = new Date();
    const diffMs = appointmentStartUTC.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // Strict 24-Hour Rule: current time must be strictly greater than 24 hours before scheduledStartAt
    // (Only evaluated for initial scheduled state; refund_pending is an in-flight recovery initiated within window)
    if (appointment.status === 'scheduled' && diffHours <= 24) {
      const err = new Error(
        'Appointments can only be cancelled strictly more than 24 hours prior to the scheduled time.'
      );
      err.statusCode = 400;
      err.code = 'CANCELLATION_WINDOW_CLOSED';
      throw err;
    }

    const refundAmount = Number(appointment.feeBreakdown?.totalFee || appointment.fee || 0);

    // ── Phase 1: Atomic Concurrency Claim ──────────────────────────────────────
    let claimedAppointment = null;

    if (appointment.status === 'scheduled') {
      claimedAppointment = await Appointment.findOneAndUpdate(
        {
          _id: appointment._id,
          patientId: appointment.patientId,
          status: 'scheduled',
        },
        {
          $set: {
            status: 'refund_pending',
            refundClaimedAt: new Date(),
            cancellationReason: reason || 'Cancelled by patient (>24h before appointment)',
            cancelledAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      );
    } else if (appointment.status === 'refund_pending') {
      // In recovery mode for an interrupted refund: atomically claim recovery lease
      const leaseThreshold = new Date(Date.now() - 5000); // 5-second lease
      claimedAppointment = await Appointment.findOneAndUpdate(
        {
          _id: appointment._id,
          patientId: appointment.patientId,
          status: 'refund_pending',
          $or: [
            { refundClaimedAt: { $exists: false } },
            { refundClaimedAt: null },
            { refundClaimedAt: { $lt: leaseThreshold } },
          ],
        },
        {
          $set: {
            refundClaimedAt: new Date(),
          },
        },
        { returnDocument: 'after' }
      );
    }

    if (!claimedAppointment) {
      // Another concurrent request holds the active claim or already finalized it.
      // Poll briefly to await finalization.
      let refreshed = await Appointment.findById(appointmentId);
      let waitAttempts = 0;
      while (refreshed?.status === 'refund_pending' && waitAttempts < 20) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        refreshed = await Appointment.findById(appointmentId);
        waitAttempts++;
      }

      if (refreshed?.status === 'cancelled') {
        return {
          success: true,
          message: `Appointment cancelled successfully. ₹${refreshed.refundAmount || refundAmount} refunded to your wallet.`,
          appointment: refreshed,
        };
      }

      const err = new Error(
        refreshed?.status === 'refund_pending'
          ? 'Cancellation and refund is already in progress for this appointment.'
          : `Cannot cancel appointment with status '${refreshed?.status}'. Only 'scheduled' appointments can be cancelled.`
      );
      err.statusCode = 400;
      throw err;
    }

    appointment = claimedAppointment;

    // ── Phase 2: Idempotent Wallet Refund Processing ──────────────────────────
    let walletResult = null;
    let existingTx = null;

    if (refundAmount > 0) {
      // Check if wallet was already credited (e.g. during a prior interrupted attempt)
      try {
        existingTx = await WalletTransaction.findOne({
          appointmentId: appointment._id,
          source: 'PATIENT_CANCELLATION',
          type: 'CREDIT',
        });
      } catch (txFindErr) {
        console.error('[CancelAppointmentUseCase] Error checking existing refund tx:', txFindErr);
      }

      if (existingTx) {
        // Idempotent hit: wallet was already credited in prior execution
        walletResult = {
          transaction: existingTx,
        };
      } else if (this.creditWalletUseCase) {
        // Execute wallet credit. If this throws, appointment remains in 'refund_pending'
        // allowing retry without losing the refund state or prematurely cancelling without payout.
        walletResult = await this.creditWalletUseCase.execute({
          patientId: appointment.patientId,
          amount: refundAmount,
          source: 'PATIENT_CANCELLATION',
          description: `Refund for appointment cancellation (>24h notice) on ${new Date(
            appointment.appointmentDate
          ).toDateString()} at ${appointment.appointmentTime}`,
          appointmentId: appointment._id,
        });
      }
    }

    // ── Phase 3: Finalize Appointment State ───────────────────────────────────
    appointment.status = 'cancelled';
    appointment.paymentStatus = 'refunded';
    appointment.refundedAt = new Date();
    appointment.refundAmount = refundAmount;
    appointment.refundId =
      existingTx?._id?.toString() ||
      walletResult?.transaction?._id?.toString() ||
      `WALLET_REFUND_${appointment._id}`;

    // Prune dead operational state
    appointment.lockedBy = undefined;
    appointment.lockExpiryTime = undefined;
    appointment.roomId = undefined;
    appointment.offlineOTP = undefined;
    appointment.lateJoinCutoffAt = undefined;

    await appointment.save();

    // ── Phase 4: Secondary Side Effects (Doctor Transaction & Notifications) ─
    try {
      await Transaction.findOneAndUpdate(
        { appointmentId: appointment._id },
        { $set: { status: 'refunded' } }
      );
    } catch (txErr) {
      console.error(`[CancelAppointmentUseCase] Error updating transaction for ${appointment._id}:`, txErr);
    }

    if (this.createNotificationUseCase && typeof this.createNotificationUseCase.execute === 'function') {
      try {
        // Patient notification
        await this.createNotificationUseCase.execute({
          recipientId: appointment.patientId,
          recipientModel: 'User',
          type: 'APPOINTMENT_CANCELLED',
          title: 'Appointment Cancelled & Refunded to Wallet',
          message: `Your appointment on ${new Date(
            appointment.appointmentDate
          ).toDateString()} at ${appointment.appointmentTime} has been cancelled. A 100% refund of ₹${refundAmount} has been credited to your wallet.`,
          referenceId: appointment._id,
        });

        // Doctor notification
        await this.createNotificationUseCase.execute({
          recipientId: appointment.doctorId,
          recipientModel: 'Doctor',
          type: 'APPOINTMENT_CANCELLED',
          title: 'Appointment Cancelled',
          message: `The appointment scheduled for ${new Date(
            appointment.appointmentDate
          ).toDateString()} at ${appointment.appointmentTime} was cancelled by the patient.`,
          referenceId: appointment._id,
        });
      } catch (notifErr) {
        console.error('[CancelAppointmentUseCase] Notification error:', notifErr);
      }
    }

    return {
      success: true,
      message: `Appointment cancelled successfully. ₹${refundAmount} refunded to your wallet.`,
      appointment,
      walletBalance: walletResult?.balance,
    };
  }
}
