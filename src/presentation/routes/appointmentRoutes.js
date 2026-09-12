import express from "express";
import {
  getPatientAppointments,
  getAvailableSlots,
  getDoctorAppointments,
  lockAppointmentSlot,
  unlockAppointmentSlot,
  extendAppointmentLock,
  getAllAppointmentsAdmin,
  getDoctorHistory,
  updateAppointmentStatus,
  completeOfflineAppointment,
  endOnlineConsultation,
  cancelAppointment,
  disputeAppointment,
  getDisputedAppointmentsAdmin,
  refundDisputedAppointmentAdmin,
  toggleDoctorSlotOverride,
  manualBookSlotDoctor,
  getAppointmentById,
  markNoShowOffline,
  getClinicalContext,
  saveClinicalNotes,
  savePrescriptions,
  uploadConsultationFile,
} from "../controllers/AppointmentController.js";
import upload from "../middleware/uploadMiddleware.js";
import { createRazorpayOrder, verifyPayment } from "../controllers/PaymentController.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";

const router = express.Router();

router.post("/lock", protect, lockAppointmentSlot);
router.post("/unlock", protect, unlockAppointmentSlot);
router.post("/extend-lock", protect, extendAppointmentLock);
router.get("/patient", protect, getPatientAppointments);
router.get("/doctor", protect, getDoctorAppointments);
router.get("/doctor/history", protect, getDoctorHistory);
router.post("/doctor/slot-override", protect, toggleDoctorSlotOverride);
router.post("/doctor/manual-book", protect, manualBookSlotDoctor);
router.patch("/:id/status", protect, updateAppointmentStatus);
router.post("/:id/complete-offline", protect, completeOfflineAppointment);
router.post("/:id/end-call", protect, endOnlineConsultation);
router.post("/:id/mark-no-show", protect, markNoShowOffline);
router.get("/availability/:doctorId", getAvailableSlots);
router.get("/admin/all", protect, adminOnly, getAllAppointmentsAdmin);

// Task 1: Patient Cancellation with Auto-Refund (12-Hour Rule)
router.post("/:id/cancel", protect, cancelAppointment);

// Task 3: Patient Dispute of Offline No-Show Appointment
router.post("/:id/dispute", protect, disputeAppointment);

// Task 3: Admin Refund & Dispute Management Routes (under /api/appointments)
router.get("/admin/disputed", protect, adminOnly, getDisputedAppointmentsAdmin);
router.post("/admin/:id/refund", protect, adminOnly, refundDisputedAppointmentAdmin);

// Payment Routes
router.post("/create-razorpay-order", protect, createRazorpayOrder);
router.post("/verify-payment", protect, verifyPayment);

// Video Consultation Hub Clinical Console & File Routes
router.get("/:id/clinical-context", protect, getClinicalContext);
router.post("/:id/clinical-notes", protect, saveClinicalNotes);
router.post("/:id/prescriptions", protect, savePrescriptions);
router.post("/:id/consultation-files", protect, upload.single("file"), uploadConsultationFile);

router.get("/:id", protect, getAppointmentById);

export default router;
