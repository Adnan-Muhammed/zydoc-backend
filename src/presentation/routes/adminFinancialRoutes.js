// src/presentation/routes/adminFinancialRoutes.js

import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  adminOnly,
  canManagePayouts,
} from "../middleware/adminMiddleware.js";
import { AdminFinancialController } from "../controllers/AdminFinancialController.js";

const router = express.Router();
const adminFinancialController = new AdminFinancialController();

// Guard: Admin & Finance permissions
router.use(protect, adminOnly, canManagePayouts);

/**
 * GET /api/admin/financials/ledger
 * Returns platform financial ledger with search, status filter, and pagination
 */
router.get("/ledger", (req, res) => adminFinancialController.getLedger(req, res));

/**
 * POST /api/admin/financials/settle/:id
 * Settles a doctor payout
 */
router.post("/settle/:id", (req, res) => adminFinancialController.settlePayout(req, res));

export default router;
