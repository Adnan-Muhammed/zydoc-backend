// src/presentation/routes/adminRefundRoutes.js

import express from "express";

// Middleware (Authentication & Granular RBAC)
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly, canManageRefunds } from "../middleware/adminMiddleware.js";

// Repositories
import { MongoRefundRepository } from "../../infrastructure/repositories/MongoRefundRepository.js";
import MongoNotificationRepository from "../../infrastructure/repositories/MongoNotificationRepository.js";

// External Services
import { socketService } from "../../infrastructure/services/SocketService.js";
import { MailService } from "../../infrastructure/security/MailService.js";

// Use Cases
import CreateNotification from "../../application/usecases/notification/CreateNotification.js";
import { GetPendingRefundsUseCase } from "../../application/usecases/admin/GetPendingRefundsUseCase.js";
import { ApproveRefundUseCase } from "../../application/usecases/admin/ApproveRefundUseCase.js";
import { RejectRefundUseCase } from "../../application/usecases/admin/RejectRefundUseCase.js";

// Controller
import { AdminRefundController } from "../controllers/AdminRefundController.js";

const router = express.Router();

// ── Dependency Injection ──────────────────────────────────────────────────────
const refundRepository = new MongoRefundRepository();
const notificationRepository = new MongoNotificationRepository();
const mailService = new MailService();

const createNotificationUseCase = new CreateNotification(
  notificationRepository,
  socketService
);

const getPendingRefundsUseCase = new GetPendingRefundsUseCase(refundRepository);
const approveRefundUseCase = new ApproveRefundUseCase(
  refundRepository,
  createNotificationUseCase,
  mailService
);
const rejectRefundUseCase = new RejectRefundUseCase(
  refundRepository,
  createNotificationUseCase,
  mailService
);

const adminRefundController = new AdminRefundController(
  getPendingRefundsUseCase,
  approveRefundUseCase,
  rejectRefundUseCase,
  refundRepository
);

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/refunds/pending
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetch unresolved/pending offline refund tickets.
 * Populates patient and appointment context for informed decision-making.
 *
 * Guard: protect → adminOnly
 * Query params: page, limit, status ("PENDING" | "UNDER_REVIEW" | "ALL")
 */
router.get(
  "/pending",
  protect,
  adminOnly,
  (req, res) => adminRefundController.getPendingRefunds(req, res)
);

/**
 * POST /api/admin/refunds/:id/approve
 * ─────────────────────────────────────────────────────────────────────────────
 * Approve a pending offline refund.
 * Executes within a single atomic MongoDB Transaction (Session):
 *  - Updates RefundTicket to 'APPROVED'
 *  - Credits the patient's wallet
 *  - Creates a WalletTransaction audit record
 *  - Sets resolvedBy (admin ID) and resolvedAt
 *
 * Guard: protect → canManageRefunds (requires "manage_refunds" or "full_access")
 */
router.post(
  "/:id/approve",
  protect,
  canManageRefunds,
  (req, res) => adminRefundController.approveRefund(req, res)
);

/**
 * POST /api/admin/refunds/:id/reject
 * ─────────────────────────────────────────────────────────────────────────────
 * Reject a pending offline refund.
 * Requires mandatory adminNote explaining why the refund was denied.
 * Updates ticket to 'REJECTED', sets resolvedBy and resolvedAt.
 *
 * Guard: protect → canManageRefunds (requires "manage_refunds" or "full_access")
 */
router.post(
  "/:id/reject",
  protect,
  canManageRefunds,
  (req, res) => adminRefundController.rejectRefund(req, res)
);

/**
 * GET /api/admin/refunds/:id
 * ─────────────────────────────────────────────────────────────────────────────
 * Fetch a single refund ticket by ID with full populated details.
 *
 * Guard: protect → adminOnly
 */
router.get(
  "/:id",
  protect,
  adminOnly,
  (req, res) => adminRefundController.getRefundById(req, res)
);

export default router;
