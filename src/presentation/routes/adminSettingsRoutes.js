// src/presentation/routes/adminSettingsRoutes.js

import express from "express";

// Middleware
import { protect } from "../middleware/authMiddleware.js";
import {
  adminOnly,
  superAdminOnly,
  canManageSettings,
} from "../middleware/adminMiddleware.js";

// Repository (Infrastructure Layer)
import { MongoCommissionRepository } from "../../infrastructure/repositories/MongoCommissionRepository.js";

// Use Cases (Application Layer)
import { GetCommissionConfigUseCase } from "../../application/usecases/admin/GetCommissionConfigUseCase.js";
import { UpdateCommissionRatesUseCase } from "../../application/usecases/admin/UpdateCommissionRatesUseCase.js";

// Controller (Presentation Layer)
import { AdminSettingsController } from "../controllers/AdminSettingsController.js";

const router = express.Router();

// ── Dependency Injection ──────────────────────────────────────────────────────
const commissionRepository = new MongoCommissionRepository();

const getCommissionConfigUseCase = new GetCommissionConfigUseCase(commissionRepository);
const updateCommissionRatesUseCase = new UpdateCommissionRatesUseCase(commissionRepository);

const adminSettingsController = new AdminSettingsController(
  getCommissionConfigUseCase,
  updateCommissionRatesUseCase
);

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/settings/commission
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetch the current commission rates and full change history.
 *
 * Guard: protect → adminOnly
 * Rationale: Any admin role can VIEW the current rates (read-only).
 *            Only super admins / settings-privileged admins can CHANGE them.
 *
 * Response:
 *   200 { success, config: { onlineCommissionRate, offlineCommissionRate, changeHistory } }
 *   404 { success, message } — if CommissionConfig seeder was never run
 */
router.get(
  "/commission",
  protect,
  adminOnly,
  (req, res) => adminSettingsController.getCommissionConfig(req, res)
);

/**
 * POST /api/admin/settings/commission
 * ─────────────────────────────────────────────────────────────────────────────
 * Update the online and/or offline commission rate.
 * Partial updates are supported (send only the rate(s) you want to change).
 *
 * Guard: protect → canManageSettings
 * Rationale: Changing commission rates directly impacts every new booking's
 *            revenue split. This is a high-stakes action restricted to admins
 *            with "system_settings" or "full_access" permission.
 *            For maximum security, swap canManageSettings for superAdminOnly
 *            if you want to restrict this to only the Super Admin.
 *
 * Request body:
 *   {
 *     onlineCommissionRate?:  number   (0–100, max 2 decimal places)
 *     offlineCommissionRate?: number   (0–100, max 2 decimal places)
 *     note?:                  string   (optional admin note for audit history)
 *   }
 *
 * Response:
 *   200 { success, message, previousRates, newRates, updatedConfig }
 *   400 { success, message } — validation error
 *   404 { success, message } — config not found
 */
router.post(
  "/commission",
  protect,
  canManageSettings,
  (req, res) => adminSettingsController.updateCommissionConfig(req, res)
);

export default router;
