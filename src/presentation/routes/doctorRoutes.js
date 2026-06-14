
// src/presentation/routes/doctorRoutes.js

import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";


import { UpdateDoctorProfile } from "../../application/usecases/doctor/UpdateDoctorProfile.js";


import { DoctorController } from "../controllers/DoctorController.js";
import { JwtService } from '../../infrastructure/security/JwtService.js';

const router = express.Router();

const userRepository = new MongoUserRepository();
const jwtService = new JwtService();                                    // ← instantiate
const updateDoctorProfileUseCase = new UpdateDoctorProfile(userRepository);
const doctorController = new DoctorController(updateDoctorProfileUseCase,jwtService );  // ← inject

router.post(
  "/profile-update",
  protect,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "medicalCertificate", maxCount: 1 },
    { name: "governmentId", maxCount: 1 },
  ]),
  (req, res) => doctorController.updateProfile(req, res)
);

export default router;