// src/presentation/routes/adminAppointmentRoutes.js

import express from "express";

// Middleware
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";

// Repositories
import { MongoAppointmentRepository } from "../../infrastructure/repositories/MongoAppointmentRepository.js";

// Use Cases
import { GetAdminAppointmentsUseCase } from "../../application/usecases/admin/GetAdminAppointmentsUseCase.js";
import { GetAdminAppointmentStatsUseCase } from "../../application/usecases/admin/GetAdminAppointmentStatsUseCase.js";

// Controller
import { AdminAppointmentController } from "../controllers/AdminAppointmentController.js";

const router = express.Router();

// ── Dependency Injection ──────────────────────────────────────────────────────
const appointmentRepository = new MongoAppointmentRepository();

const getAdminAppointmentsUseCase = new GetAdminAppointmentsUseCase(
  appointmentRepository
);
const getAdminAppointmentStatsUseCase = new GetAdminAppointmentStatsUseCase(
  appointmentRepository
);

const adminAppointmentController = new AdminAppointmentController(
  getAdminAppointmentsUseCase,
  getAdminAppointmentStatsUseCase,
  appointmentRepository
);

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/appointments
 * ─────────────────────────────────────────────────────────────────────────────
 * Master list of consultations with robust filtering:
 *  - status (pending, ongoing, completed, cancelled, refunded)
 *  - type (online, offline)
 *  - date range (startDate, endDate)
 *  - search (Patient Name or Doctor Name)
 *  - clean population of patient (name, avatar) and doctor (name, specialty)
 *  - pagination and sorting (latest first)
 *
 * Guard: protect → adminOnly
 */
router.get(
  "/",
  protect,
  adminOnly,
  (req, res) => adminAppointmentController.getAppointments(req, res)
);

/**
 * GET /api/admin/appointments/stats
 * ─────────────────────────────────────────────────────────────────────────────
 * Aggregate consultation metrics and revenue statistics for dashboard cards.
 *
 * Guard: protect → adminOnly
 */
router.get(
  "/stats",
  protect,
  adminOnly,
  (req, res) => adminAppointmentController.getAppointmentStats(req, res)
);

/**
 * GET /api/admin/appointments/:id
 * ─────────────────────────────────────────────────────────────────────────────
 * Single consultation detail view with full clinical and financial context.
 *
 * Guard: protect → adminOnly
 */
router.get(
  "/:id",
  protect,
  adminOnly,
  (req, res) => adminAppointmentController.getAppointmentById(req, res)
);

export default router;
