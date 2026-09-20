// src/presentation/controllers/AdminRefundController.js

/**
 * ── Admin Refund Controller ───────────────────────────────────────────────────
 * Presentation layer controller handling admin refund HTTP requests.
 * Thin controller adhering to Clean Architecture principles:
 * validates input, delegates to UseCases, maps results/errors to HTTP responses.
 *
 * Injected UseCases:
 *  - getPendingRefundsUseCase
 *  - approveRefundUseCase
 *  - rejectRefundUseCase
 */
export class AdminRefundController {
  constructor(getPendingRefundsUseCase, approveRefundUseCase, rejectRefundUseCase, refundRepository = null) {
    this.getPendingRefundsUseCase = getPendingRefundsUseCase;
    this.approveRefundUseCase = approveRefundUseCase;
    this.rejectRefundUseCase = rejectRefundUseCase;
    this.refundRepository = refundRepository;
  }

  // ── GET /api/admin/refunds/pending ──────────────────────────────────────────
  /**
   * Fetches unresolved/pending offline refund tickets.
   * Populates patient, doctor, and appointment data for complete context.
   *
   * Query params:
   *  - page: number (default: 1)
   *  - limit: number (default: 20)
   *  - status: string ("PENDING", "UNDER_REVIEW", "ALL" - default: "PENDING")
   */
  async getPendingRefunds(req, res) {
    try {
      const { page = 1, limit = 20, status = "PENDING" } = req.query;

      const result = await this.getPendingRefundsUseCase.execute({
        page,
        limit,
        status,
      });

      return res.status(200).json({
        success: true,
        message: `${result.total} pending refund ticket(s) found.`,
        ...result,
      });
    } catch (error) {
      console.error("[getPendingRefunds] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to fetch pending refund tickets.",
      });
    }
  }

  // ── GET /api/admin/refunds/:id ──────────────────────────────────────────────
  /**
   * Fetches details of a specific refund ticket by its ID.
   */
  async getRefundById(req, res) {
    try {
      const { id } = req.params;

      if (!this.refundRepository) {
        return res.status(501).json({
          success: false,
          message: "Refund repository detail fetch not configured.",
        });
      }

      const ticket = await this.refundRepository.getTicketById(id);

      return res.status(200).json({
        success: true,
        ticket,
      });
    } catch (error) {
      console.error("[getRefundById] Error:", error.message);
      const status = error.statusCode || (error.message.includes("not found") ? 404 : 500);
      return res.status(status).json({
        success: false,
        message: error.message || "Failed to fetch refund ticket.",
      });
    }
  }

  // ── POST /api/admin/refunds/:id/approve ─────────────────────────────────────
  /**
   * Approves a pending offline refund ticket inside an atomic MongoDB Transaction.
   * Credits the patient's wallet and creates a WalletTransaction audit entry.
   *
   * Path params:
   *  - id: RefundTicket ID
   *
   * Request body:
   *  - adminNote?: string (optional internal resolution note)
   *  - refundAmount?: number (optional override; if omitted, defaults to full appointment fee)
   */
  async approveRefund(req, res) {
    try {
      const { id } = req.params;
      const adminUserId = req.user.id || req.user._id;
      const { adminNote, refundAmount } = req.body;

      const result = await this.approveRefundUseCase.execute({
        ticketId: id,
        adminUserId,
        adminNote,
        refundAmount,
      });

      return res.status(200).json({
        success: true,
        message: "Refund ticket approved and patient wallet credited successfully.",
        ticket: result.ticket,
        refundAmount: result.refundAmount,
        walletTransaction: result.walletTransaction,
        patientNewBalance: result.patientNewBalance,
      });
    } catch (error) {
      console.error("[approveRefund] Error:", error.message);

      let statusCode = error.statusCode || 500;
      if (error.message.includes("not found")) {
        statusCode = 404;
      } else if (
        error.message.includes("already") ||
        error.message.includes("Invalid") ||
        error.message.includes("required") ||
        error.message.includes("Cannot approve")
      ) {
        statusCode = 400;
      }

      return res.status(statusCode).json({
        success: false,
        message: error.message || "Failed to approve refund ticket.",
      });
    }
  }

  // ── POST /api/admin/refunds/:id/reject ──────────────────────────────────────
  /**
   * Rejects a refund ticket.
   * Requires an adminNote explaining the rejection reason.
   *
   * Path params:
   *  - id: RefundTicket ID
   *
   * Request body:
   *  - adminNote: string (mandatory, min 10 chars)
   */
  async rejectRefund(req, res) {
    try {
      const { id } = req.params;
      const adminUserId = req.user.id || req.user._id;
      const { adminNote } = req.body;

      const ticket = await this.rejectRefundUseCase.execute({
        ticketId: id,
        adminUserId,
        adminNote,
      });

      return res.status(200).json({
        success: true,
        message: "Refund ticket rejected successfully.",
        ticket,
      });
    } catch (error) {
      console.error("[rejectRefund] Error:", error.message);

      let statusCode = error.statusCode || 500;
      if (error.message.includes("not found")) {
        statusCode = 404;
      } else if (
        error.message.includes("required") ||
        error.message.includes("already") ||
        error.message.includes("minimum") ||
        error.message.includes("Cannot reject") ||
        error.message.includes("Invalid")
      ) {
        statusCode = 400;
      }

      return res.status(statusCode).json({
        success: false,
        message: error.message || "Failed to reject refund ticket.",
      });
    }
  }
}
