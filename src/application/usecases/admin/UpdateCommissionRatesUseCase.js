// src/application/usecases/admin/UpdateCommissionRatesUseCase.js

/**
 * ── Update Commission Rates Use Case ─────────────────────────────────────────
 * Updates the online and/or offline commission rates on the singleton
 * CommissionConfig document.
 *
 * Business rules enforced at this layer:
 *  1. At least one rate must be provided in the request.
 *  2. Each provided rate must be a finite number between 0 and 100 (inclusive).
 *  3. Rates cannot be negative.
 *  4. A rate of exactly 100% is technically valid but unusual — we allow it
 *     since some platforms take 100% for demo/test consultations.
 *
 * The audit trail entry (previous rate, new rate, who, when) is built and
 * persisted by the repository layer.
 *
 * Used by: POST /api/admin/settings/commission
 */
export class UpdateCommissionRatesUseCase {
  constructor(commissionRepository) {
    this.commissionRepository = commissionRepository;
  }

  /**
   * @param {object} params
   * @param {number|undefined} params.onlineCommissionRate   - New online rate %
   * @param {number|undefined} params.offlineCommissionRate  - New offline rate %
   * @param {string}           params.adminUserId            - ID of the acting admin
   * @param {string}           [params.note]                 - Optional admin note
   */
  async execute({ onlineCommissionRate, offlineCommissionRate, adminUserId, note }) {
    // ── Business Rule 1: At least one rate must be provided ───────────────────
    const hasOnline = onlineCommissionRate !== undefined && onlineCommissionRate !== null;
    const hasOffline = offlineCommissionRate !== undefined && offlineCommissionRate !== null;

    if (!hasOnline && !hasOffline) {
      throw new Error(
        "At least one commission rate (onlineCommissionRate or offlineCommissionRate) must be provided."
      );
    }

    // ── Business Rule 2: Validate each provided rate ───────────────────────────
    if (hasOnline) {
      this._validateRate("onlineCommissionRate", onlineCommissionRate);
    }
    if (hasOffline) {
      this._validateRate("offlineCommissionRate", offlineCommissionRate);
    }

    // ── Delegate to repository ─────────────────────────────────────────────────
    return await this.commissionRepository.updateRates({
      onlineCommissionRate: hasOnline ? onlineCommissionRate : null,
      offlineCommissionRate: hasOffline ? offlineCommissionRate : null,
      adminUserId,
      note: note || "",
    });
  }

  /**
   * Validates that a commission rate value is:
   *  - A finite number (not NaN, not Infinity)
   *  - Between 0 and 100 inclusive
   *  - Not negative
   *
   * @param {string} fieldName - Used in error messages for clarity
   * @param {*}      value     - The value to validate
   * @throws {Error} If validation fails
   */
  _validateRate(fieldName, value) {
    const num = Number(value);

    if (!Number.isFinite(num)) {
      throw new Error(
        `${fieldName} must be a valid number. Received: "${value}".`
      );
    }

    if (num < 0) {
      throw new Error(
        `${fieldName} cannot be negative. Received: ${num}.`
      );
    }

    if (num > 100) {
      throw new Error(
        `${fieldName} cannot exceed 100%. Received: ${num}.`
      );
    }

    // Reject values with more than 2 decimal places (e.g. 15.555%)
    // to keep commission math clean in payout calculations.
    const rounded = Math.round(num * 100) / 100;
    if (rounded !== num) {
      throw new Error(
        `${fieldName} supports a maximum of 2 decimal places. Received: ${num}. Did you mean ${rounded}?`
      );
    }
  }
}
