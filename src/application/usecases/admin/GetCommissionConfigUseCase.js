// src/application/usecases/admin/GetCommissionConfigUseCase.js

/**
 * ── Get Commission Config Use Case ────────────────────────────────────────────
 * Retrieves the current commission rates from the singleton CommissionConfig.
 * Returns the full document including the changeHistory audit trail.
 *
 * Used by: GET /api/admin/settings/commission
 */
export class GetCommissionConfigUseCase {
  constructor(commissionRepository) {
    this.commissionRepository = commissionRepository;
  }

  async execute() {
    return await this.commissionRepository.getConfig();
  }
}
