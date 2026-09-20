// src/domain/repositories/CommissionRepository.js

/**
 * ── Commission Repository Interface ──────────────────────────────────────────
 * Abstract contract that defines the commission config data operations.
 * The concrete implementation (MongoCommissionRepository) depends on this,
 * not the other way around — satisfying the Dependency Inversion Principle.
 */
export class CommissionRepository {
  /**
   * Retrieve the singleton commission configuration document.
   * @returns {Promise<object>} The CommissionConfig document.
   */
  async getConfig() {
    throw new Error("CommissionRepository.getConfig() not implemented");
  }

  /**
   * Update commission rates on the singleton document.
   * Appends a full audit entry to changeHistory.
   *
   * @param {object} params
   * @param {number|null} params.onlineCommissionRate   - New online rate (null = no change)
   * @param {number|null} params.offlineCommissionRate  - New offline rate (null = no change)
   * @param {string}      params.adminUserId            - SharedUser._id of the acting admin
   * @param {string}      [params.note]                 - Optional admin note for context
   * @returns {Promise<object>} The updated CommissionConfig document.
   */
  async updateRates({ onlineCommissionRate, offlineCommissionRate, adminUserId, note }) {
    throw new Error("CommissionRepository.updateRates() not implemented");
  }
}
