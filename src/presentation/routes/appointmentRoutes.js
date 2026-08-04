import express from "express";
import { createAppointment, getPatientAppointments, getAvailableSlots, getDoctorAppointments, lockAppointmentSlot, unlockAppointmentSlot } from "../controllers/AppointmentController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", protect, createAppointment);
router.post("/lock", protect, lockAppointmentSlot);
router.post("/unlock", protect, unlockAppointmentSlot);
router.get("/patient", protect, getPatientAppointments);
router.get("/doctor", protect, getDoctorAppointments);
router.get("/availability/:doctorId", getAvailableSlots);

export default router;
