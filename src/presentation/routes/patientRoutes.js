// src/presentation/routes/patientRoutes.js

import express from "express";
import upload from "../middleware/uploadMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";

import { UpdatePatientProfile } from "../../application/usecases/patient/UpdatePatientProfile.js";
import { GetPatientProfile } from "../../application/usecases/patient/GetPatientProfile.js";
import { AddMedicalRecord } from "../../application/usecases/patient/AddMedicalRecord.js";
import { GetMedicalRecords } from "../../application/usecases/patient/GetMedicalRecords.js";
import { DeleteMedicalRecord } from "../../application/usecases/patient/DeleteMedicalRecord.js";
import { PatientController } from "../controllers/PatientController.js";
import { MedicalRecordController } from "../controllers/MedicalRecordController.js";
import { JwtService } from '../../infrastructure/security/JwtService.js';

const router = express.Router(); 

const userRepository = new MongoUserRepository();
const jwtService = new JwtService();
const updatePatientProfileUseCase = new UpdatePatientProfile(userRepository);
const getPatientProfileUseCase = new GetPatientProfile(userRepository);

const addMedicalRecordUseCase = new AddMedicalRecord();
const getMedicalRecordsUseCase = new GetMedicalRecords();
const deleteMedicalRecordUseCase = new DeleteMedicalRecord();

const patientController = new PatientController(
    updatePatientProfileUseCase,
    getPatientProfileUseCase,
    jwtService
);

const medicalRecordController = new MedicalRecordController(
    addMedicalRecordUseCase,
    getMedicalRecordsUseCase,
    deleteMedicalRecordUseCase
);

router.get("/profile", protect, (req, res) => patientController.getProfile(req, res));

router.put(
  "/profile-update",
  protect,
  upload.fields([
    { name: "avatar", maxCount: 1 }
  ]),
  (req, res) => patientController.updateProfile(req, res)
);

router.put(
  "/profile",
  protect,
  upload.fields([
    { name: "avatar", maxCount: 1 }
  ]),
  (req, res) => patientController.updateProfile(req, res)
);

// Medical Records Routes
router.post(
  "/records",
  protect,
  upload.single("file"),
  (req, res) => medicalRecordController.addRecord(req, res)
);

router.get("/records", protect, (req, res) => medicalRecordController.getRecords(req, res));
router.delete("/records/:id", protect, (req, res) => medicalRecordController.deleteRecord(req, res));

export default router;
