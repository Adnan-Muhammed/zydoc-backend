// src/presentation/controllers/AdminSettingsController.js

/**
 * ── Admin Settings Controller ─────────────────────────────────────────────────
 * Handles all admin settings HTTP actions.
 * Currently covers commission configuration; can be extended for other
 * system settings (e.g., slot duration limits, refund policy windows).
 *
 * Injected use cases:
 *  - getCommissionConfigUseCase
 *  - updateCommissionRatesUseCase
 */
export class AdminSettingsController {
  constructor(getCommissionConfigUseCase, updateCommissionRatesUseCase) {
    this.getCommissionConfigUseCase = getCommissionConfigUseCase;
    this.updateCommissionRatesUseCase = updateCommissionRatesUseCase;
  }

  // ── GET /api/admin/settings/commission ────────────────────────────────────
  /**
   * Fetches the current commission rates and full change history.
   *
   * Response shape:
   * {
   *   success: true,
   *   config: {
   *     _id, onlineCommissionRate, offlineCommissionRate,
   *     changeHistory: [...], updatedAt, createdAt
   *   }
   * }
   */
  async getCommissionConfig(req, res) {
    try {
      const config = await this.getCommissionConfigUseCase.execute();

      return res.status(200).json({
        success: true,
        config,
      });
    } catch (error) {
      console.error("[getCommissionConfig] Error:", error.message);

      if (error.message.includes("not found")) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to fetch commission configuration.",
        error: error.message,
      });
    }
  }

  // ── POST /api/admin/settings/commission ───────────────────────────────────
  /**
   * Updates the online and/or offline commission rate.
   * Partial updates are supported — only the provided rate(s) are changed.
   *
   * Request body:
   * {
   *   onlineCommissionRate?:  number  (0–100, max 2 decimal places)
   *   offlineCommissionRate?: number  (0–100, max 2 decimal places)
   *   note?:                  string  (optional admin note for audit trail)
   * }
   *
   * Response shape:
   * {
   *   success: true,
   *   message: "Commission rates updated successfully.",
   *   previousRates: { online, offline },
   *   newRates:      { online, offline },
   *   updatedConfig: { ...full CommissionConfig document }
   * }
   */
  async updateCommissionConfig(req, res) {
    try {
      const adminUserId = req.user.id; // Populated by protect middleware
      const { onlineCommissionRate, offlineCommissionRate, note } = req.body;

      // ── Early HTTP-level type coercion ────────────────────────────────────
      // Convert string inputs (common from form submissions) to numbers.
      // The use case will then validate the numeric values.
      const parsedOnline =
        onlineCommissionRate !== undefined && onlineCommissionRate !== null
          ? Number(onlineCommissionRate)
          : undefined;

      const parsedOffline =
        offlineCommissionRate !== undefined && offlineCommissionRate !== null
          ? Number(offlineCommissionRate)
          : undefined;

      // Capture previous rates before update for the response (user-facing diff)
      // We fetch a snapshot here purely for the response message; the repository
      // independently captures this in changeHistory.
      const previousConfig = await this.getCommissionConfigUseCase.execute();
      const previousOnline = previousConfig.onlineCommissionRate;
      const previousOffline = previousConfig.offlineCommissionRate;

      // ── Execute the update use case ───────────────────────────────────────
      const updatedConfig = await this.updateCommissionRatesUseCase.execute({
        onlineCommissionRate: parsedOnline,
        offlineCommissionRate: parsedOffline,
        adminUserId,
        note: note || "",
      });

      return res.status(200).json({
        success: true,
        message: "Commission rates updated successfully.",
        previousRates: {
          online: previousOnline,
          offline: previousOffline,
        },
        newRates: {
          online: updatedConfig.onlineCommissionRate,
          offline: updatedConfig.offlineCommissionRate,
        },
        updatedConfig,
      });
    } catch (error) {
      console.error("[updateCommissionConfig] Error:", error.message);

      // ── Semantic error mapping ────────────────────────────────────────────
      // Validation errors from the use case → 400 Bad Request
      const validationMessages = [
        "At least one commission rate",
        "must be a valid number",
        "cannot be negative",
        "cannot exceed 100%",
        "supports a maximum of 2 decimal places",
        "No changes detected",
      ];

      const isValidationError = validationMessages.some((msg) =>
        error.message.includes(msg)
      );

      if (isValidationError) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      if (error.message.includes("not found")) {
        return res.status(404).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to update commission rates.",
        error: error.message,
      });
    }
  }
}
