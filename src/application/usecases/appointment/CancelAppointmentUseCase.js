import Appointment from '../../../infrastructure/database/models/Appointment.js';
import Transaction from '../../../infrastructure/database/models/Transaction.js';
import { getSlotExactUTC } from '../../../infrastructure/utils/timeUtils.js';

export class CancelAppointmentUseCase {
  constructor(creditWalletUseCase, createNotificationUseCase = null) {
    this.creditWalletUseCase = creditWalletUseCase;
    this.createNotificationUseCase = createNotificationUseCase;
  }

  async execute({ appointmentId, patientId, doctorId, userRole, reason }) {
    if (!appointmentId) throw new Error('appointmentId is required');

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      const err = new Error('Appointment not found');
      err.statusCode = 404;
      throw err;
    }

    // Only scheduled appointments can be cancelled
    if (appointment.status !== 'scheduled') {
      const err = new Error(
        `Cannot cancel appointment with status '${appointment.status}'. Only 'scheduled' appointments can be cancelled.`
      );
      err.statusCode = 400;
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

      appointment.status = 'cancelled-by-doctor';
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
    if (diffHours <= 24) {
      const err = new Error(
        'Appointments can only be cancelled strictly more than 24 hours prior to the scheduled time.'
      );
      err.statusCode = 400;
      err.code = 'CANCELLATION_WINDOW_CLOSED';
      throw err;
    }

    const refundAmount = Number(appointment.feeBreakdown?.totalFee || appointment.fee || 0);

    // 1. Credit full refund to patient's wallet
    let walletResult = null;
    if (refundAmount > 0 && this.creditWalletUseCase) {
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

    // 2. Update appointment record
    appointment.status = 'cancelled';
    appointment.paymentStatus = 'refunded';
    appointment.cancellationReason = reason || 'Cancelled by patient (>24h before appointment)';
    appointment.cancelledAt = new Date();
    appointment.refundedAt = new Date();
    appointment.refundAmount = refundAmount;

    // Prune dead operational state
    appointment.lockedBy = undefined;
    appointment.lockExpiryTime = undefined;
    appointment.roomId = undefined;
    appointment.offlineOTP = undefined;
    appointment.lateJoinCutoffAt = undefined;

    await appointment.save();

    // 3. Cancel doctor's platform transaction payout
    try {
      await Transaction.findOneAndUpdate(
        { appointmentId: appointment._id },
        { $set: { status: 'refunded' } }
      );
    } catch (txErr) {
      console.error(`[CancelAppointmentUseCase] Error updating transaction for ${appointment._id}:`, txErr);
    }

    // 4. Trigger notifications
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
