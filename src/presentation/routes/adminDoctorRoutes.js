// src/presentation/routes/adminDoctorRoutes.js

import express from "express";

// Middleware
import { protect } from "../middleware/authMiddleware.js";
import {
  adminOnly,
  canManageDoctors,
} from "../middleware/adminMiddleware.js";

// Repository
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";

// Use Cases
import { GetPendingDoctorsUseCase } from "../../application/usecases/admin/GetPendingDoctorsUseCase.js";
import { GetDoctorsUseCase } from "../../application/usecases/admin/GetDoctorsUseCase.js";
import { ApproveDoctorUseCase } from "../../application/usecases/admin/ApproveDoctorUseCase.js";
import { RejectDoctorUseCase } from "../../application/usecases/admin/RejectDoctorUseCase.js";
import { GetDoctorStatsUseCase } from "../../application/usecases/admin/GetDoctorStatsUseCase.js";

// Controller
import { AdminDoctorController } from "../controllers/AdminDoctorController.js";

const router = express.Router();

// ── Dependency Injection ──────────────────────────────────────────────────────
const userRepository = new MongoUserRepository();

const getPendingDoctorsUseCase = new GetPendingDoctorsUseCase(userRepository);
const getAdminDoctorsUseCase = new GetDoctorsUseCase(userRepository);
const approveDoctorUseCase = new ApproveDoctorUseCase(userRepository);
const rejectDoctorUseCase = new RejectDoctorUseCase(userRepository);
const getDoctorStatsUseCase = new GetDoctorStatsUseCase(userRepository);

const adminDoctorController = new AdminDoctorController(
  getPendingDoctorsUseCase,
  getAdminDoctorsUseCase,
  approveDoctorUseCase,
  rejectDoctorUseCase,
  getDoctorStatsUseCase
);

// ── Routes ────────────────────────────────────────────────────────────────────
// All routes: must be authenticated + must be an admin.
// Action routes (approve/reject) additionally require `canManageDoctors` permission.

/**
 * GET /api/admin/doctors/pending
 * Fetch all doctors waiting for approval (verificationStatus = "pending").
 * Sorted FIFO. Supports ?page=1&limit=20 pagination.
 *
 * Guard: protect → adminOnly
 * (Any admin can view the queue)
 */
router.get(
  "/pending",
  protect,
  adminOnly,
  (req, res) => adminDoctorController.getPendingDoctors(req, res)
);

/**
 * GET /api/admin/doctors/stats
 * Returns aggregate doctor counts for KPI cards on the dashboard.
 *
 * Guard: protect → adminOnly
 */
router.get(
  "/stats",
  protect,
  adminOnly,
  (req, res) => adminDoctorController.getDoctorStats(req, res)
);

/**
 * GET /api/admin/doctors
 * Master doctor list with search, filter, and pagination.
 *
 * Query params:
 *   ?search=<string>
 *   &verificationStatus=pending|approved|rejected
 *   &accountStatus=active|suspended
 *   &specialty=<string>
 *   &sort=newest|oldest|name
 *   &page=<number>
 *   &limit=<number>
 *
 * Guard: protect → adminOnly
 */
router.get(
  "/",
  protect,
  adminOnly,
  (req, res) => adminDoctorController.getDoctors(req, res)
);

/**
 * POST /api/admin/doctors/:id/approve
 * Approve a doctor's application.
 *
 * Route param: id — the doctor's SharedUser._id
 * Body: (none required)
 *
 * Guard: protect → canManageDoctors (requires "manage_doctors" or "full_access")
 * Side effects: Sets verifiedBy, verifiedAt, activates account, logs audit trail
 */
router.post(
  "/:id/approve",
  protect,
  canManageDoctors,
  (req, res) => adminDoctorController.approveDoctor(req, res)
);

/**
 * POST /api/admin/doctors/:id/reject
 * Reject a doctor's application with a mandatory reason.
 *
 * Route param: id — the doctor's SharedUser._id
 * Body: { rejectionReason: string (min 10 characters) }
 *
 * Guard: protect → canManageDoctors (requires "manage_doctors" or "full_access")
 * Side effects: Stores rejectionReason, suspends account, logs audit trail
 */
router.post(
  "/:id/reject",
  protect,
  canManageDoctors,
  (req, res) => adminDoctorController.rejectDoctor(req, res)
);

/**
 * GET /api/admin/doctors/:id
 * Fetch a single doctor's full profile by their SharedUser._id.
 *
 * Guard: protect → adminOnly
 */
router.get(
  "/:id",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const doctor = await userRepository.getAdminDoctorById(req.params.id);
      if (!doctor) {
        return res.status(404).json({ success: false, message: "Doctor not found" });
      }
      res.json({ success: true, doctor });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

export default router;
