import Appointment from '../../../infrastructure/database/models/Appointment.js';
import Transaction from '../../../infrastructure/database/models/Transaction.js';

export class ApproveOfflineDisputeUseCase {
  constructor(creditWalletUseCase, createNotificationUseCase = null) {
    this.creditWalletUseCase = creditWalletUseCase;
    this.createNotificationUseCase = createNotificationUseCase;
  }

  async execute({ appointmentId, adminId, notes = '' }) {
    if (!appointmentId) throw new Error('appointmentId is required');

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      const err = new Error('Appointment not found');
      err.statusCode = 404;
      throw err;
    }

    if (appointment.status === 'refunded' || appointment.paymentStatus === 'refunded') {
      const err = new Error('Appointment is already refunded');
      err.statusCode = 400;
      throw err;
    }

    const refundAmount = Number(appointment.feeBreakdown?.totalFee || appointment.fee || 0);

    // 1. Credit full refund to patient's wallet
    let walletResult = null;
    if (refundAmount > 0 && this.creditWalletUseCase) {
      walletResult = await this.creditWalletUseCase.execute({
        patientId: appointment.patientId,
        amount: refundAmount,
        source: 'OFFLINE_DISPUTE',
        description: `Refund for offline consultation dispute on ${new Date(
          appointment.appointmentDate
        ).toDateString()} approved by Admin`,
        appointmentId: appointment._id,
      });
    }

    // 2. Update appointment status
    appointment.status = 'refunded';
    appointment.paymentStatus = 'refunded';
    appointment.disputeResolvedAt = new Date();
    appointment.refundedAt = new Date();
    appointment.refundAmount = refundAmount;
    appointment.adminRefundNotes = notes || 'Refund approved by Admin after dispute investigation.';

    await appointment.save();

    // 3. Cancel doctor payout in platform Transaction
    try {
      await Transaction.findOneAndUpdate(
        { appointmentId: appointment._id },
        { $set: { status: 'refunded' } }
      );
    } catch (txErr) {
      console.error(`[ApproveOfflineDisputeUseCase] Error updating transaction for ${appointment._id}:`, txErr);
    }

    // 4. Notify patient and doctor
    if (this.createNotificationUseCase && typeof this.createNotificationUseCase.execute === 'function') {
      try {
        // Patient notification
        await this.createNotificationUseCase.execute({
          recipientId: appointment.patientId,
          recipientModel: 'User',
          type: 'REFUND_APPROVED',
          title: 'Dispute Approved & Refunded to Wallet',
          message: `Your dispute for appointment on ${new Date(
            appointment.appointmentDate
          ).toDateString()} has been approved. ₹${refundAmount} has been credited to your wallet.`,
          referenceId: appointment._id,
        });

        // Doctor notification
        await this.createNotificationUseCase.execute({
          recipientId: appointment.doctorId,
          recipientModel: 'Doctor',
          type: 'PAYOUT_CANCELLED',
          title: 'Offline Dispute Settled - Payout Cancelled',
          message: `The dispute for the appointment on ${new Date(
            appointment.appointmentDate
          ).toDateString()} was settled in favor of the patient. The doctor payout has been cancelled.`,
          referenceId: appointment._id,
        });
      } catch (notifErr) {
        console.error('[ApproveOfflineDisputeUseCase] Notification error:', notifErr);
      }
    }

    return {
      success: true,
      message: 'Dispute approved and refund credited to patient wallet.',
      appointment,
      walletBalance: walletResult?.balance,
    };
  }
}
