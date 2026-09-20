// src/domain/repositories/RefundRepository.js

/**
 * ── Refund Repository Interface (Domain Layer) ───────────────────────────────
 * Abstract contract defining all persistence operations for offline RefundTickets.
 * Concrete implementation is provided in the Infrastructure layer (MongoRefundRepository).
 */
export class RefundRepository {
  /**
   * Fetches pending offline refund tickets with pagination and full population
   * (patient, doctor, appointment context).
   *
   * @param {object} params
   * @param {number} [params.page]
   * @param {number} [params.limit]
   * @param {string} [params.status] - "PENDING", "UNDER_REVIEW", or "ALL"
   * @returns {Promise<{ tickets: object[], total: number, page: number, limit: number, totalPages: number }>}
   */
  async getPendingTickets({ page = 1, limit = 20, status = "PENDING" } = {}) {
    throw new Error("Method not implemented.");
  }

  /**
   * Fetches a single refund ticket by ID with populated details.
   *
   * @param {string} id - RefundTicket ObjectId
   * @returns {Promise<object>}
   */
  async getTicketById(id) {
    throw new Error("Method not implemented.");
  }

  /**
   * Approves an offline refund ticket atomically within a MongoDB Transaction session:
   *  1. Updates RefundTicket status to 'APPROVED', sets resolvedBy, resolvedAt, refundAmount
   *  2. Credits patient wallet balance on PatientProfile
   *  3. Creates WalletTransaction record with source 'OFFLINE_DISPUTE'
   *  4. Updates Appointment status to 'refunded'
   *  5. Cancels/refunds platform doctor Transaction record
   *  6. Appends to AdminProfile.adminActivityLog
   *
   * @param {object} params
   * @param {string} params.ticketId
   * @param {string} params.adminUserId
   * @param {number} [params.refundAmount]
   * @param {string} [params.adminNote]
   * @returns {Promise<{ ticket: object, walletTransaction: object, refundAmount: number, patientNewBalance: number }>}
   */
  async approveTicket({ ticketId, adminUserId, refundAmount, adminNote }) {
    throw new Error("Method not implemented.");
  }

  /**
   * Rejects an offline refund ticket with mandatory adminNote/rejectionReason.
   *
   * @param {object} params
   * @param {string} params.ticketId
   * @param {string} params.adminUserId
   * @param {string} params.adminNote
   * @returns {Promise<object>} The updated RefundTicket
   */
  async rejectTicket({ ticketId, adminUserId, adminNote }) {
    throw new Error("Method not implemented.");
  }
}
