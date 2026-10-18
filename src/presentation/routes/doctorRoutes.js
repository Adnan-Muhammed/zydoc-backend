// src/presentation/routes/doctorRoutes.js

import express from "express";
import upload, { verifyUploadSignatures } from "../middleware/uploadMiddleware.js";
import { protect } from "../middleware/authMiddleware.js";
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";
import { MongoTransactionRepository } from "../../infrastructure/repositories/MongoTransactionRepository.js";

import { UpdateDoctorProfile } from "../../application/usecases/doctor/UpdateDoctorProfile.js";
import { PatchDoctorProfile } from "../../application/usecases/doctor/PatchDoctorProfile.js";
import { GetDoctorProfile } from "../../application/usecases/doctor/GetDoctorProfile.js";
import { UpdateFcmToken } from "../../application/usecases/doctor/UpdateFcmToken.js";
import { GetDoctorEarnings } from "../../application/usecases/doctor/GetDoctorEarnings.js";
import { UpdateBankDetails } from "../../application/usecases/doctor/UpdateBankDetails.js";

import { DoctorController } from "../controllers/DoctorController.js";
import { JwtService } from '../../infrastructure/security/JwtService.js';
import { preventSuspendedDoctorAction } from "../middleware/preventSuspendedDoctorMiddleware.js";

const router = express.Router();

// Enforce authentication and block mutating actions if doctor is suspended
router.use(protect);
router.use(preventSuspendedDoctorAction);

const userRepository = new MongoUserRepository();
const transactionRepository = new MongoTransactionRepository();
const jwtService = new JwtService();

const updateDoctorProfileUseCase = new UpdateDoctorProfile(userRepository);
const patchDoctorProfileUseCase = new PatchDoctorProfile(userRepository);
const getDoctorProfileUseCase = new GetDoctorProfile(userRepository);
const updateFcmTokenUseCase = new UpdateFcmToken();
const getDoctorEarningsUseCase = new GetDoctorEarnings(transactionRepository);
const updateBankDetailsUseCase = new UpdateBankDetails(userRepository);

const doctorController = new DoctorController(
  updateDoctorProfileUseCase,
  jwtService,
  patchDoctorProfileUseCase,
  null, // uploadDoctorDocuments (not implemented yet)
  getDoctorProfileUseCase,
  updateFcmTokenUseCase,
  getDoctorEarningsUseCase,
  updateBankDetailsUseCase
);

/**
 * Validation middleware: strictly verifies that an avatar file or URL is present
 * during doctor profile completion. Rejects with 400 if missing.
 */
export const validateDoctorAvatar = (userRepo) => async (req, res, next) => {
  try {
    const avatarFile = req.files?.avatar?.[0];
    let avatarUrl = req.body?.avatarUrl;
    if (!avatarUrl && req.body?.data) {
      try {
        const parsed = JSON.parse(req.body.data);
        avatarUrl = parsed?.avatarUrl;
      } catch (_) {}
    }

    if (!avatarFile && !avatarUrl) {
      const userId = req.user?.id;
      if (userId && userRepo) {
        const user = await userRepo.findById(userId);
        if (user?.doctorProfile?.avatarUrl || user?.avatarUrl) {
          return next();
        }
      }
      return res.status(400).json({
        success: false,
        message: "Profile picture is mandatory",
        field: "avatar",
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};

router.post(
  "/profile-update",
  protect,
  upload.fields([
    { name: "avatar", maxCount: 1 },
    { name: "medicalCertificate", maxCount: 1 },
    { name: "governmentId", maxCount: 1 },
    { name: "qualificationCertificates", maxCount: 20 },
  ]),
  verifyUploadSignatures(),
  validateDoctorAvatar(userRepository),
  (req, res) => doctorController.updateProfile(req, res)
);

// Modular Profile Update Routes
router.get("/profile", protect, (req, res) => doctorController.getProfile(req, res));
router.patch("/profile/basic-info", protect, (req, res) => doctorController.updateBasicInfo(req, res));
router.patch("/profile/consultation", protect, (req, res) => doctorController.updateConsultation(req, res));
router.put("/profile/qualifications", protect, upload.any(), verifyUploadSignatures(), (req, res) => doctorController.updateQualifications(req, res));
router.patch("/profile/preferences", protect, (req, res) => doctorController.updatePreferences(req, res));
router.patch("/profile/schedule", protect, (req, res) => doctorController.updateSchedule(req, res));
router.post("/profile/certificates", protect, upload.array("certificates", 10), (req, res) => doctorController.uploadCertificates(req, res));

// Doctor Earnings & Payout Bank Details
router.get("/dashboard-stats", protect, (req, res) => doctorController.getDashboardStats(req, res));
router.get("/earnings", protect, (req, res) => doctorController.getEarnings(req, res));
router.patch("/bank-details", protect, (req, res) => doctorController.updateBankDetails(req, res));

// FCM Token Registration
// Called automatically by the frontend after notification permission is granted.
// Stores the device's FCM token on the doctor's profile for targeted push notifications.
router.patch("/fcm-token", protect, (req, res) => doctorController.saveFcmToken(req, res));

// ── Doctor "My Patients" Historical Directory & Clinical Records ─────────────
import { DoctorPatientsController } from "../controllers/DoctorPatientsController.js";
const doctorPatientsController = new DoctorPatientsController();

router.get("/my-patients", (req, res) => doctorPatientsController.getMyPatients(req, res));
router.get("/my-patients/:patientId/history", (req, res) => doctorPatientsController.getPatientHistory(req, res));

export default router;  