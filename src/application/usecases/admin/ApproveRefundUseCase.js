// src/application/usecases/admin/ApproveRefundUseCase.js

/**
 * ── Approve Refund Use Case ───────────────────────────────────────────────────
 * Approves a pending offline refund ticket.
 *
 * Business Logic & Constraints:
 *  1. Validates ticketId and adminUserId
 *  2. If an explicit refundAmount is provided, validates that it is a positive number
 *  3. Delegates atomic execution to the repository (MongoDB Transaction) to guarantee
 *     that ticket approval and patient wallet crediting cannot become desynchronized
 *  4. Dispatches non-blocking notifications to the patient
 */
export class ApproveRefundUseCase {
  constructor(refundRepository, createNotificationUseCase = null, mailService = null) {
    this.refundRepository = refundRepository;
    this.createNotificationUseCase = createNotificationUseCase;
    this.mailService = mailService;
  }

  /**
   * @param {object} params
   * @param {string} params.ticketId
   * @param {string} params.adminUserId
   * @param {string} [params.adminNote=""]
   * @param {number} [params.refundAmount]
   * @returns {Promise<{ ticket: object, walletTransaction: object, refundAmount: number, patientNewBalance: number }>}
   */
  async execute({ ticketId, adminUserId, adminNote = "", refundAmount = null }) {
    if (!ticketId) {
      const error = new Error("ticketId is required.");
      error.statusCode = 400;
      throw error;
    }

    if (!adminUserId) {
      const error = new Error("adminUserId is required.");
      error.statusCode = 400;
      throw error;
    }

    if (refundAmount !== null && refundAmount !== undefined) {
      const parsedAmount = Number(refundAmount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        const error = new Error(
          "If specified, refundAmount must be a valid positive number."
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const result = await this.refundRepository.approveTicket({
      ticketId,
      adminUserId,
      adminNote,
      refundAmount: refundAmount !== null ? Number(refundAmount) : null,
    });

    // Fire non-blocking patient notifications & email
    this._sendNotifications(result, adminNote).catch((err) =>
      console.error(
        "[ApproveRefundUseCase] Non-blocking notification dispatch error:",
        err.message
      )
    );

    return result;
  }

  /**
   * Non-blocking notification helper
   */
  async _sendNotifications(result, adminNote) {
    const { ticket, refundAmount, patientUserId, patientEmail } = result;
    const ticketIdStr = ticket?._id ? ticket._id.toString() : String(ticket);

    // 1. In-app notification for patient
    if (this.createNotificationUseCase && patientUserId) {
      try {
        await this.createNotificationUseCase.execute({
          recipientId: patientUserId,
          recipientModel: "User",
          type: "REFUND_APPROVED",
          title: "Refund Approved & Credited to Wallet",
          message: `Your offline consultation refund request (Ticket #${ticketIdStr.slice(
            -6
          )}) has been approved. ₹${refundAmount} has been credited to your wallet balance.`,
          referenceId: ticketIdStr,
        });
      } catch (notifErr) {
        console.error(
          "[ApproveRefundUseCase] Patient in-app notification error:",
          notifErr.message
        );
      }
    }

    // 2. Email confirmation to patient
    if (this.mailService && patientEmail && typeof this.mailService.sendRefundApprovedEmail === "function") {
      try {
        await this.mailService.sendRefundApprovedEmail({
          patientEmail,
          patientName: "Patient",
          refundAmount,
          ticketId: ticketIdStr,
          note: adminNote,
        });
      } catch (mailErr) {
        console.error(
          "[ApproveRefundUseCase] Patient email delivery error:",
          mailErr.message
        );
      }
    }
  }
}
