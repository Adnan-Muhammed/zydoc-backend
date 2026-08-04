// src/presentation/routes/doctorRoutes.js

import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";

import { UpdateDoctorProfile } from "../../application/usecases/doctor/UpdateDoctorProfile.js";
import { PatchDoctorProfile } from "../../application/usecases/doctor/PatchDoctorProfile.js";
import { GetDoctorProfile } from "../../application/usecases/doctor/GetDoctorProfile.js";

import { DoctorController } from "../controllers/DoctorController.js";
import { JwtService } from '../../infrastructure/security/JwtService.js';

const router = express.Router();

const userRepository = new MongoUserRepository();
const jwtService = new JwtService();
const updateDoctorProfileUseCase = new UpdateDoctorProfile(userRepository);
const patchDoctorProfileUseCase = new PatchDoctorProfile(userRepository);
const getDoctorProfileUseCase = new GetDoctorProfile(userRepository);

const doctorController = new DoctorController(
  updateDoctorProfileUseCase,
  jwtService,
  patchDoctorProfileUseCase,
  null, // uploadDoctorDocuments (not implemented yet)
  getDoctorProfileUseCase
);

router.post(
  "/profile-update",
  protect,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "medicalCertificate", maxCount: 1 },
    { name: "governmentId", maxCount: 1 },
    { name: "qualificationCertificates", maxCount: 20 },
  ]),
  (req, res) => doctorController.updateProfile(req, res)
);

// Modular Profile Update Routes
router.get("/profile", protect, (req, res) => doctorController.getProfile(req, res));
router.patch("/profile/basic-info", protect, (req, res) => doctorController.updateBasicInfo(req, res));
router.patch("/profile/consultation", protect, (req, res) => doctorController.updateConsultation(req, res));
router.put("/profile/qualifications", protect, upload.any(), (req, res) => doctorController.updateQualifications(req, res));
router.patch("/profile/preferences", protect, (req, res) => doctorController.updatePreferences(req, res));
router.patch("/profile/schedule", protect, (req, res) => doctorController.updateSchedule(req, res));
router.post("/profile/certificates", protect, upload.array("certificates", 10), (req, res) => doctorController.uploadCertificates(req, res));

export default router;  