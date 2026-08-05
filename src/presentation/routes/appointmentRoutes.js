import express from "express";
import { createAppointment, getPatientAppointments, getAvailableSlots, getDoctorAppointments, lockAppointmentSlot, unlockAppointmentSlot } from "../controllers/AppointmentController.js";
import { createRazorpayOrder, verifyPayment } from "../controllers/PaymentController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", protect, createAppointment);
router.post("/lock", protect, lockAppointmentSlot);
router.post("/unlock", protect, unlockAppointmentSlot);
router.get("/patient", protect, getPatientAppointments);
router.get("/doctor", protect, getDoctorAppointments);
router.get("/availability/:doctorId", getAvailableSlots); 

// Payment Routes
router.post("/create-razorpay-order", protect, createRazorpayOrder);
router.post("/verify-payment", protect, verifyPayment);

export default router;
