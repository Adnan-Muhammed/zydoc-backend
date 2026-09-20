// src/presentation/routes/adminUserRoutes.js

import express from "express";

// Middleware
import { protect } from "../middleware/authMiddleware.js";
import {
  adminOnly,
  canManageUsers,
  canManageDoctors,
} from "../middleware/adminMiddleware.js";

// Repository
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";

// Use Case
import { ToggleUserStatusUseCase } from "../../application/usecases/admin/ToggleUserStatusUseCase.js";

// Controller
import { AdminUserController } from "../controllers/AdminUserController.js";

const router = express.Router();

// ── Dependency Injection ──────────────────────────────────────────────────────
const userRepository = new MongoUserRepository();
const toggleUserStatusUseCase = new ToggleUserStatusUseCase(userRepository);
const adminUserController = new AdminUserController(toggleUserStatusUseCase);

// ── Base Middleware Guard ─────────────────────────────────────────────────────
router.use(protect, adminOnly);

// ── Routes ────────────────────────────────────────────────────────────────────
/**
 * POST /api/admin/users/doctors/:id/toggle-status
 * Toggle a doctor's account status between 'active' and 'suspended'.
 * Protected by admin privileges and canManageDoctors/canManageUsers RBAC.
 */
router.post(
  "/doctors/:id/toggle-status",
  canManageDoctors,
  (req, res) => adminUserController.toggleDoctorStatus(req, res)
);

/**
 * POST /api/admin/users/patients/:id/toggle-status
 * Toggle a patient's account status between 'active' and 'suspended'.
 * Protected by admin privileges and canManageUsers RBAC.
 */
router.post(
  "/patients/:id/toggle-status",
  canManageUsers,
  (req, res) => adminUserController.togglePatientStatus(req, res)
);

export default router;
