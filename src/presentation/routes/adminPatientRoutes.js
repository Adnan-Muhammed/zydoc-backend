// src/presentation/routes/adminPatientRoutes.js

import express from "express";

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

// Dependency Injection

const userRepository = new MongoUserRepository();

const getPatientsUseCase = new GetPatientsUseCase(userRepository);
const getPatientStatsUseCase = new GetPatientStatsUseCase(userRepository);

const adminPatientController = new AdminPatientController(getPatientsUseCase, getPatientStatsUseCase);

// Routes

router.get("/", protect, adminOnly, (req, res) =>
  adminPatientController.getPatients(req, res),
);

router.get("/stats", protect, adminOnly, (req, res) =>
  adminPatientController.getPatientStats(req, res),
);

router.get("/:id", protect, adminOnly, async (req, res) => {
  try {
    const patient = await userRepository.getAdminPatientById(req.params.id);
    if (!patient) {
      return res.status(404).json({ success: false, message: "Patient not found" });
    }
    res.json({ success: true, user: patient });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
