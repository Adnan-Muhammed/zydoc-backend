// src/presentation/routes/adminPatientRoutes.js

import express from "express";

// Middleware
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";

// Repository
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";

// UseCase
import { GetPatientsUseCase } from "../../application/usecases/admin/GetPatientsUseCase.js";
import { GetPatientStatsUseCase } from "../../application/usecases/admin/GetPatientStatsUseCase.js";

// Controller
import { AdminPatientController } from "../controllers/AdminPatientController.js";

const router = express.Router();

// ── Dependency Injection ──────────────────────────────────────────────────────
const userRepository = new MongoUserRepository();

const getPatientsUseCase = new GetPatientsUseCase(userRepository);
const getPatientStatsUseCase = new GetPatientStatsUseCase(userRepository);

const adminPatientController = new AdminPatientController(
  getPatientsUseCase,
  getPatientStatsUseCase,
  userRepository
);

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/patients
 * Fetch master list of registered patients with pagination, search, and per-patient stats.
 */
router.get("/", protect, adminOnly, (req, res) =>
  adminPatientController.getPatients(req, res)
);

/**
 * GET /api/admin/patients/stats
 * Overview stats across all registered patients for KPI cards.
 */
router.get("/stats", protect, adminOnly, (req, res) =>
  adminPatientController.getPatientStats(req, res)
);

/**
 * GET /api/admin/patients/:id
 * Fetch detailed profile, appointment history, and financial stats for a single patient.
 */
router.get("/:id", protect, adminOnly, (req, res) =>
  adminPatientController.getPatientById(req, res)
);

export default router;
