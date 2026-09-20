// src/application/usecases/admin/RejectRefundUseCase.js

/**
 * ── Reject Refund Use Case ───────────────────────────────────────────────────
 * Rejects a pending offline refund ticket.
 *
 * Business Logic & Constraints:
 *  1. Validates ticketId and adminUserId
 *  2. Enforces mandatory adminNote explaining why the refund was denied (minimum 10 chars)
 *  3. Updates ticket status to 'REJECTED', records resolvedBy (admin ID) and resolvedAt
 *  4. Dispatches non-blocking notification to the patient
 */
export class RejectRefundUseCase {
  constructor(refundRepository, createNotificationUseCase = null, mailService = null) {
    this.refundRepository = refundRepository;
    this.createNotificationUseCase = createNotificationUseCase;
    this.mailService = mailService;
  }

  /**
   * @param {object} params
   * @param {string} params.ticketId
   * @param {string} params.adminUserId
   * @param {string} params.adminNote - Mandatory explanation for rejection
   * @returns {Promise<object>} The updated RefundTicket
   */
  async execute({ ticketId, adminUserId, adminNote }) {
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

    if (
      !adminNote ||
      typeof adminNote !== "string" ||
      adminNote.trim().length < 10
    ) {
      const error = new Error(
        "A detailed admin note explaining why the refund was denied is required (minimum 10 characters)."
      );
      error.statusCode = 400;
      throw error;
    }

    const ticket = await this.refundRepository.rejectTicket({
      ticketId,
      adminUserId,
      adminNote: adminNote.trim(),
    });

    // Fire non-blocking patient notifications & email
    this._sendNotifications(ticket, adminNote.trim()).catch((err) =>
      console.error(
        "[RejectRefundUseCase] Non-blocking notification dispatch error:",
        err.message
      )
    );

    return ticket;
  }

  /**
   * Non-blocking notification helper
   */
  async _sendNotifications(ticket, adminNote) {
    const ticketIdStr = ticket?._id ? ticket._id.toString() : String(ticket);
    const patientUserId =
      ticket.patientId?._id || ticket.patientId;

    // 1. In-app notification for patient
    if (this.createNotificationUseCase && patientUserId) {
      try {
        await this.createNotificationUseCase.execute({
          recipientId: patientUserId,
          recipientModel: "User",
          type: "REFUND_REJECTED",
          title: "Refund Request Rejected",
          message: `Your offline consultation refund request (Ticket #${ticketIdStr.slice(
            -6
          )}) was rejected. Reason: ${adminNote}`,
          referenceId: ticketIdStr,
        });
      } catch (notifErr) {
        console.error(
          "[RejectRefundUseCase] Patient in-app notification error:",
          notifErr.message
        );
      }
    }

    // 2. Email notification to patient
    const patientEmail = ticket.patientId?.email;
    if (this.mailService && patientEmail && typeof this.mailService.sendRefundRejectedEmail === "function") {
      try {
        await this.mailService.sendRefundRejectedEmail({
          patientEmail,
          patientName: "Patient",
          ticketId: ticketIdStr,
          reason: adminNote,
        });
      } catch (mailErr) {
        console.error(
          "[RejectRefundUseCase] Patient email delivery error:",
          mailErr.message
        );
      }
    }
  }
}
