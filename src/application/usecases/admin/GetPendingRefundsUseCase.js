// src/application/usecases/admin/GetPendingRefundsUseCase.js

/**
 * ── Get Pending Refunds Use Case ───────────────────────────────────────────────
 * Fetches all unresolved/pending offline refund tickets awaiting admin action.
 * Populates patient details (name, contact, wallet balance) and appointment details
 * (consultation fee, breakdown, booking info) to provide complete context.
 */
export class GetPendingRefundsUseCase {
  constructor(refundRepository) {
    this.refundRepository = refundRepository;
  }

  /**
   * @param {object} params
   * @param {number} [params.page=1]
   * @param {number} [params.limit=20]
   * @param {string} [params.status="PENDING"]
   * @returns {Promise<{ tickets: object[], total: number, page: number, limit: number, totalPages: number }>}
   */
  async execute({ page = 1, limit = 20, status = "PENDING" } = {}) {
    return await this.refundRepository.getPendingTickets({ page, limit, status });
  }
}
