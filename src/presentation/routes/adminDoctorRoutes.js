// src/presentation/routes/adminDoctorRoutes.js

import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";

// Repository
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";

// UseCase 
import { GetDoctorsUseCase } from "../../application/usecases/admin/GetDoctorsUseCase.js";
import { GetDoctorStatsUseCase } from "../../application/usecases/admin/GetDoctorStatsUseCase.js";

// Controller
import { AdminDoctorController } from "../controllers/AdminDoctorController.js";

const router = express.Router();

// Dependency Injection

const userRepository = new MongoUserRepository();

const getDoctorsUseCase = new GetDoctorsUseCase(userRepository);
const getDoctorStatsUseCase = new GetDoctorStatsUseCase(userRepository);

const adminDoctorController = new AdminDoctorController(getDoctorsUseCase, getDoctorStatsUseCase);

// Routes

router.get("/", protect, adminOnly, (req, res) =>
  adminDoctorController.getDoctors(req, res),
);

router.get("/stats", protect, adminOnly, (req, res) =>
  adminDoctorController.getDoctorStats(req, res),
);

router.get("/:id", protect, adminOnly, async (req, res) => {
  try {
    const doctor = await userRepository.getAdminDoctorById(req.params.id);
    if (!doctor) {
      return res.status(404).json({ success: false, message: "Doctor not found" });
    }
    res.json({ success: true, user: doctor });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
