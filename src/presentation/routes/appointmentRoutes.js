import express from "express";
import {  getPatientAppointments, getAvailableSlots, getDoctorAppointments, lockAppointmentSlot, unlockAppointmentSlot, extendAppointmentLock, getAllAppointmentsAdmin, getDoctorHistory, updateAppointmentStatus } from "../controllers/AppointmentController.js";
import { createRazorpayOrder, verifyPayment } from "../controllers/PaymentController.js";
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";

const router = express.Router();

// router.post("/", protect, createAppointment);
router.post("/lock", protect, lockAppointmentSlot);
router.post("/unlock", protect, unlockAppointmentSlot);
router.post("/extend-lock", protect, extendAppointmentLock);
router.get("/patient", protect, getPatientAppointments);
router.get("/doctor", protect, getDoctorAppointments);
router.get("/doctor/history", protect, getDoctorHistory);
router.patch("/:id/status", protect, updateAppointmentStatus);
router.get("/availability/:doctorId", getAvailableSlots);
router.get("/admin/all", protect, adminOnly, getAllAppointmentsAdmin);

// Payment Routes
router.post("/create-razorpay-order", protect, createRazorpayOrder);
router.post("/verify-payment", protect, verifyPayment);

export default router;
