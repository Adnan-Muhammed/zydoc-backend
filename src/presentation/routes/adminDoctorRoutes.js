// src/presentation/routes/adminDoctorRoutes.js

import express from "express";

import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";

// Repository
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";

// UseCase 
import { GetDoctorsUseCase } from "../../application/usecases/admin/GetDoctorsUseCase.js";

// Controller
import { AdminDoctorController } from "../controllers/AdminDoctorController.js";

const router = express.Router();

// Dependency Injection

const userRepository = new MongoUserRepository();

const getDoctorsUseCase = new GetDoctorsUseCase(userRepository);

const adminDoctorController = new AdminDoctorController(getDoctorsUseCase);

// Routes

router.get("/", protect, adminOnly, (req, res) =>
  adminDoctorController.getDoctors(req, res),
);

export default router;
