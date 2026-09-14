import Appointment from "../../infrastructure/database/models/Appointment.js";
import ConsultationRecord from "../../infrastructure/database/models/ConsultationRecord.js";
import Doctor from "../../infrastructure/database/models/DoctorProfile.js";
import SharedUser from "../../infrastructure/database/models/SharedUser.js";
import Patient from "../../infrastructure/database/models/PatientProfile.js";
import DoctorSlotOverride from "../../infrastructure/database/models/DoctorSlotOverride.js";
import { LockSlot } from "../../application/usecases/appointment/LockSlot.js";
import { UnlockSlot } from "../../application/usecases/appointment/UnlockSlot.js";
import { GetPatientAppointments } from "../../application/usecases/appointment/GetPatientAppointments.js";
import { GetDoctorAppointments } from "../../application/usecases/appointment/GetDoctorAppointments.js";
import { GetAllAppointmentsAdmin } from "../../application/usecases/appointment/GetAllAppointmentsAdmin.js";
import { GetDoctorHistory } from "../../application/usecases/appointment/GetDoctorHistory.js";
import { ExtendSlotLock } from "../../application/usecases/appointment/ExtendSlotLock.js";
import { MongoAppointmentRepository } from "../../infrastructure/repositories/MongoAppointmentRepository.js";
import { 
    parseTimeStr, 
    formatTo12H, 
    getUTCDayBounds, 
    getSlotExactUTC,
    getDoctorTimezone,
    getBookingCutoffMs,
    getRemainingSlotMinutes,
    getLateJoinGraceMinutes
} from "../../infrastructure/utils/timeUtils.js";
import { razorpayRefund } from "../../infrastructure/services/RazorpayService.js";
import Transaction from "../../infrastructure/database/models/Transaction.js";
import Admin from "../../infrastructure/database/models/AdminProfile.js";
import MongoNotificationRepository from "../../infrastructure/repositories/MongoNotificationRepository.js";
import CreateNotification from "../../application/usecases/notification/CreateNotification.js";
import { socketService } from "../../infrastructure/services/SocketService.js";
import mongoose from "mongoose";

const appointmentRepo = new MongoAppointmentRepository();
const lockSlotUseCase = new LockSlot(appointmentRepo);
const unlockSlotUseCase = new UnlockSlot(appointmentRepo);
const getPatientAppointmentsUseCase = new GetPatientAppointments(appointmentRepo);
const getDoctorAppointmentsUseCase = new GetDoctorAppointments(appointmentRepo);
const getAllAppointmentsAdminUseCase = new GetAllAppointmentsAdmin(appointmentRepo);
const getDoctorHistoryUseCase = new GetDoctorHistory(appointmentRepo);
const extendSlotLockUseCase = new ExtendSlotLock(appointmentRepo);
const notificationRepo = new MongoNotificationRepository();
const createNotificationUseCase = new CreateNotification(notificationRepo, socketService);

// Get appointments for a specific patient
export const getPatientAppointments = async (req, res) => {
    try {
        const patientId = req.user.id || req.user._id;

        if (!patientId) {
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }

        // Lazy update No-Shows before fetching patient appointments
        await appointmentRepo.lazyUpdateNoShows({ patientId });

        const appointments = await getPatientAppointmentsUseCase.execute(patientId);

        res.status(200).json({ success: true, appointments });
    } catch (error) {
        console.error("Get Patient Appointments Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

// Get appointments for a specific doctor
export const getDoctorAppointments = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }

        const sharedUser = await SharedUser.findById(userId);
        if (!sharedUser || !sharedUser.profileId) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        const doctorId = sharedUser.profileId;

        // Lazy update No-Shows before fetching upcoming appointments
        await appointmentRepo.lazyUpdateNoShows(doctorId);

        const appointments = await getDoctorAppointmentsUseCase.execute(doctorId);

        res.status(200).json({ success: true, appointments });
    } catch (error) {
        console.error("Get Doctor Appointments Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const getDoctorHistory = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }

        const sharedUser = await SharedUser.findById(userId);
        if (!sharedUser || !sharedUser.profileId) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }

        const doctorId = sharedUser.profileId;

        // Lazy update No-Shows before fetching history appointments
        await appointmentRepo.lazyUpdateNoShows(doctorId);

        const appointments = await getDoctorHistoryUseCase.execute(doctorId);

        res.status(200).json({ success: true, appointments });
    } catch (error) {
        console.error("Get Doctor History Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const updateAppointmentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!['completed', 'no-show'].includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status update" });
        }

        const appointment = await Appointment.findById(id);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found" });
        }

        if (appointment.status !== 'scheduled') {
            return res.status(400).json({ success: false, message: "Only 'scheduled' appointments can be updated" });
        }

        appointment.status = status;
        await appointment.save();

        res.status(200).json({ success: true, message: `Appointment marked as ${status}`, appointment });
    } catch (error) {
        console.error("Update Appointment Status Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * POST /appointments/:id/complete-offline
 * Doctor-only endpoint that verifies the patient's 4-digit OTP and marks
 * the offline appointment as completed, finalising the transaction payout.
 */
export const completeOfflineAppointment = async (req, res) => {
    try {
        const { id } = req.params;
        const { otp } = req.body;

        if (!otp || otp.toString().length !== 4) {
            return res.status(400).json({ success: false, message: "A valid 4-digit OTP is required." });
        }

        // Only doctors may call this endpoint
        if (req.user?.role !== 'doctor') {
            return res.status(403).json({ success: false, message: "Only doctors can complete offline appointments." });
        }

        const appointment = await Appointment.findById(id);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        // Guard: must be offline type and currently scheduled
        if (!['offline', 'physical'].includes(appointment.consultationType)) {
            return res.status(400).json({ success: false, message: "This is not an offline appointment." });
        }
        if (appointment.status !== 'scheduled') {
            return res.status(400).json({ success: false, message: `Appointment is already '${appointment.status}'.` });
        }

        // OTP verification (Only required for online platform bookings; bypassed for direct manual offline bookings)
        if (!appointment.isManualBooking) {
            if (!otp || otp.toString().length !== 4) {
                return res.status(400).json({ success: false, message: "A valid 4-digit OTP is required." });
            }
            if (!appointment.offlineOTP) {
                return res.status(400).json({ success: false, message: "No verification code is set for this appointment." });
            }
            if (appointment.offlineOTP.toString() !== otp.toString()) {
                return res.status(400).json({ success: false, message: "Invalid verification code. Please ask the patient to check their code." });
            }
            appointment.offlineOTPVerifiedAt = new Date();
        }

        // Mark appointment complete
        appointment.status = 'completed';
        appointment.sessionEndedAt = new Date();
        await appointment.save();

        // Mark the linked transaction as completed (unlocks payout eligibility - platform bookings only)
        if (!appointment.isManualBooking) {
            try {
                const { MongoTransactionRepository } = await import('../../infrastructure/repositories/MongoTransactionRepository.js');
                const txRepo = new MongoTransactionRepository();
                await txRepo.updateStatusByAppointmentId(id, 'completed');
            } catch (txErr) {
                // Non-blocking — log but do not rollback the appointment status
                console.error(`[completeOfflineAppointment] Failed to update transaction for ${id}:`, txErr);
            }
        }

        console.log(`[completeOfflineAppointment] Appointment ${id} verified and completed.`);
        res.status(200).json({
            success: true,
            message: "Appointment successfully completed.",
            appointment,
        });
    } catch (error) {
        console.error("Complete Offline Appointment Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const endOnlineConsultation = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?._id?.toString();
        const userRole = req.user?.role;

        if (userRole !== 'doctor') {
            return res.status(403).json({ success: false, message: "Only doctors can conclude the consultation." });
        }

        const { MongoAppointmentRepository } = await import('../../infrastructure/repositories/MongoAppointmentRepository.js');
        const { MongoTransactionRepository } = await import('../../infrastructure/repositories/MongoTransactionRepository.js');
        const { EndRoomUseCase } = await import('../../modules/video-call/use-cases/EndRoomUseCase.js');
        const { socketService } = await import('../../infrastructure/services/SocketService.js');

        const gateway = {
            broadcastToRoom: (roomId, event, payload) => socketService.emitToRoom(roomId, event, payload),
            emitToUser: (uId, event, payload) => socketService.emitToUser(uId, event, payload),
            getRoomSize: (roomId) => {
                const room = socketService.io?.sockets?.adapter?.rooms?.get(roomId);
                return room ? room.size : 0;
            }
        };

        const endRoom = new EndRoomUseCase(gateway, new MongoAppointmentRepository(), new MongoTransactionRepository());
        await endRoom.execute(id, userId, userRole);

        res.status(200).json({
            success: true,
            message: "Consultation successfully concluded and completed."
        });
    } catch (error) {
        console.error("End Online Consultation Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const getAvailableSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date, consultationType } = req.query; // e.g. "2026-09-15", "video" / "online"

        if (!date) {
            return res.status(400).json({ success: false, message: "Date is required" });
        }

        let doctorObjectId;
        try {
            doctorObjectId = new mongoose.Types.ObjectId(doctorId);
        } catch (error) {
            return res.status(400).json({ success: false, message: "Invalid Doctor ID format" });
        }

        let doctor = await Doctor.findById(doctorObjectId);
        if (!doctor) {
            const sharedUser = await SharedUser.findById(doctorObjectId);
            if (sharedUser && sharedUser.profileId) {
                doctor = await Doctor.findById(sharedUser.profileId);
                if (doctor) {
                    doctorObjectId = doctor._id;
                }
            }
        }
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found" });
        }

        const doctorTimezone = getDoctorTimezone(doctor);

        // Standardize channel selection (online vs offline vs all)
        const isUnified = !consultationType || consultationType === 'all';
        const requestedChannel = !isUnified ? ((consultationType === 'offline' || consultationType === 'physical') ? 'offline' : 'online') : null;

        const isOnlineEnabled = doctor.consultationSettings?.online?.enabled ?? doctor.consultationSettings?.video?.enabled ?? true;
        const isOfflineEnabled = doctor.consultationSettings?.offline?.enabled ?? doctor.consultationSettings?.physical?.enabled ?? false;

        if (requestedChannel === 'online' && !isOnlineEnabled) {
            return res.status(400).json({ success: false, message: "Doctor does not offer online consultation." });
        }
        if (requestedChannel === 'offline' && !isOfflineEnabled) {
            return res.status(400).json({ success: false, message: "Doctor does not offer in-person consultation." });
        }

        // ── 1. Resolve day of week & operating shift blocks ────────────────────
        const { startOfDayUTC, endOfDayUTC } = getUTCDayBounds(date);
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayOfWeek = dayNames[startOfDayUTC.getUTCDay()];

        const extractBlocks = (channelKey) => {
            const rawChannelSchedule = doctor.workingHours?.[channelKey] || (doctor.workingHours?.online || doctor.workingHours?.offline ? null : doctor.workingHours) || {};
            let dayConfig = rawChannelSchedule[dayOfWeek];

            const isWeekday = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(dayOfWeek);
            const isDayEmpty = !dayConfig || (Array.isArray(dayConfig) && dayConfig.length === 0) || (typeof dayConfig === 'object' && !dayConfig.active);

            if (isDayEmpty) {
                if (isWeekday && rawChannelSchedule.mondayToFriday) {
                    dayConfig = rawChannelSchedule.mondayToFriday;
                } else if (rawChannelSchedule.fullWeek) {
                    dayConfig = rawChannelSchedule.fullWeek;
                }
            }

            if (Array.isArray(dayConfig)) {
                return dayConfig.filter(b => b && b.start && b.end);
            } else if (dayConfig && typeof dayConfig === 'object' && dayConfig.active && dayConfig.start && dayConfig.end) {
                return [{ start: dayConfig.start, end: dayConfig.end }];
            }
            return [];
        };

        const onlineBlocks = isOnlineEnabled ? extractBlocks('online') : [];
        const offlineBlocks = isOfflineEnabled ? extractBlocks('offline') : [];

        // Check if any blocks exist for the requested mode
        if (requestedChannel === 'online' && onlineBlocks.length === 0) {
            return res.status(200).json({ success: true, doctorWorking: false, slots: [], allSlots: [] });
        }
        if (requestedChannel === 'offline' && offlineBlocks.length === 0) {
            return res.status(200).json({ success: true, doctorWorking: false, slots: [], allSlots: [] });
        }
        if (isUnified && onlineBlocks.length === 0 && offlineBlocks.length === 0) {
            return res.status(200).json({ success: true, doctorWorking: false, slots: [], allSlots: [] });
        }

        // ── 2. Generate all valid slots from active channel blocks ──────────
        const slotDuration = Number(doctor.slotDuration) || 15;
        const candidateSlotMap = new Map();

        // Helper to generate slots for a channel's blocks
        const processBlocks = (blocks, channelName) => {
            blocks.forEach(block => {
                const s = parseTimeStr(block.start);
                const e = parseTimeStr(block.end);
                let sMins = s.h * 60 + s.m;
                let eMins = e.h * 60 + e.m;
                if (eMins <= sMins) eMins += 24 * 60;

                let cur = sMins;
                while (cur + slotDuration <= eMins) {
                    const slotEnd = cur + slotDuration;
                    const hFull = Math.floor(cur / 60) % 24;
                    const m = cur % 60;
                    const slotTime = formatTo12H(hFull, m);

                    if (!candidateSlotMap.has(cur)) {
                        candidateSlotMap.set(cur, {
                            time: slotTime,
                            startMins: cur,
                            endMins: slotEnd,
                            hasOnline: channelName === 'online',
                            hasOffline: channelName === 'offline'
                        });
                    } else {
                        const existing = candidateSlotMap.get(cur);
                        if (channelName === 'online') existing.hasOnline = true;
                        if (channelName === 'offline') existing.hasOffline = true;
                    }
                    cur += slotDuration;
                }
            });
        };

        if (requestedChannel === 'online') {
            processBlocks(onlineBlocks, 'online');
        } else if (requestedChannel === 'offline') {
            processBlocks(offlineBlocks, 'offline');
        } else {
            processBlocks(onlineBlocks, 'online');
            processBlocks(offlineBlocks, 'offline');
        }

        // Sort all unique slots chronologically
        const sortedCandidateSlots = Array.from(candidateSlotMap.values())
            .sort((a, b) => a.startMins - b.startMins);

        if (sortedCandidateSlots.length === 0) {
            return res.status(200).json({ success: true, doctorWorking: true, slots: [], allSlots: [] });
        }

        // ── 3. Group slots into distinct Shifts whenever a gap occurs ──────────
        let currentShiftIdx = 1;
        let lastEndMins = -1;
        const shiftGroups = [];
        let currentShift = null;

        sortedCandidateSlots.forEach(slot => {
            let slotType = 'mixed';
            if (slot.hasOnline && slot.hasOffline) slotType = 'mixed';
            else if (slot.hasOnline) slotType = 'online';
            else if (slot.hasOffline) slotType = 'offline';
            slot.slotType = slotType;

            // Gap detected: start a new shift
            if (lastEndMins === -1 || slot.startMins > lastEndMins) {
                if (currentShift) {
                    shiftGroups.push(currentShift);
                    currentShiftIdx++;
                }
                currentShift = {
                    shiftIndex: currentShiftIdx,
                    shiftName: `Shift ${currentShiftIdx}`,
                    startMins: slot.startMins,
                    endMins: slot.endMins,
                    slots: [slot]
                };
            } else {
                currentShift.endMins = Math.max(currentShift.endMins, slot.endMins);
                currentShift.slots.push(slot);
            }
            lastEndMins = slot.endMins;
        });
        if (currentShift) {
            shiftGroups.push(currentShift);
        }

        // Tag every slot with its accurate shift metadata
        const generatedSlotsInfo = [];
        shiftGroups.forEach(group => {
            const shiftStartFormatted = formatTo12H(Math.floor(group.startMins / 60) % 24, group.startMins % 60);
            const shiftEndFormatted = formatTo12H(Math.floor(group.endMins / 60) % 24, group.endMins % 60);
            
            const hasOnline = group.slots.some(s => s.hasOnline);
            const hasOffline = group.slots.some(s => s.hasOffline);
            const shiftType = (hasOnline && hasOffline) ? 'mixed' : (hasOnline ? 'online' : 'offline');

            group.slots.forEach(slot => {
                generatedSlotsInfo.push({
                    time: slot.time,
                    startMins: slot.startMins,
                    endMins: slot.endMins,
                    slotType: slot.slotType,
                    shiftIndex: group.shiftIndex,
                    shiftName: group.shiftName,
                    shiftStart: shiftStartFormatted,
                    shiftEnd: shiftEndFormatted,
                    shiftType
                });
            });
        });

        // ── 4. UNIFIED Conflict Check across ALL appointments (online + offline) 
        const existingAppointments = await Appointment.find({
            doctorId: doctorObjectId,
            appointmentDate: { $gte: startOfDayUTC, $lte: endOfDayUTC },
            $or: [
                { status: { $in: ['scheduled', 'completed'] } },
                { status: 'locked', lockExpiryTime: { $gt: new Date() } }
            ]
        }).populate('patientId', 'firstName lastName googleName email');

        const bookedIntervals = existingAppointments.map(app => {
            const parsedTime = parseTimeStr(app.appointmentTime);
            const startMins = parsedTime.h * 60 + parsedTime.m;
            let duration = slotDuration;
            if (app.scheduledStartAt && app.scheduledEndAt) {
                const diffMins = Math.round((new Date(app.scheduledEndAt) - new Date(app.scheduledStartAt)) / 60000);
                if (diffMins > 0) duration = diffMins;
            }

            return {
                startMins,
                endMins: startMins + duration,
                status: app.status,
                appointment: app
            };
        });

        // ── 5. Strict UTC-based Past / Expiry Status & Range-Based Overlap Evaluation ─────────────────
        const now = new Date();

        // Fetch Doctor Slot Overrides (Break / Closed slots) for this specific date
        const possibleDoctorIds = [doctorObjectId];
        if (doctor && doctor._id && !possibleDoctorIds.some(id => String(id) === String(doctor._id))) {
            possibleDoctorIds.push(doctor._id);
        }
        const doctorSharedUser = await SharedUser.findOne({ profileId: doctor._id || doctorObjectId });
        if (doctorSharedUser && !possibleDoctorIds.some(id => String(id) === String(doctorSharedUser._id))) {
            possibleDoctorIds.push(doctorSharedUser._id);
        }

        const slotOverrides = await DoctorSlotOverride.find({
            doctorId: { $in: possibleDoctorIds },
            date: date
        });
        const overrideMap = new Map();
        slotOverrides.forEach(ov => {
            if (ov.time) {
                overrideMap.set(ov.time.trim().toUpperCase(), ov);
                overrideMap.set(ov.time.trim(), ov);
            }
        });

        const allSlotsWithStatus = generatedSlotsInfo.map(slotInfo => {
            const { time: slotTime, startMins: candidateStartMins, endMins: candidateEndMins, slotType, shiftIndex, shiftName, shiftStart, shiftEnd, shiftType } = slotInfo;

            // Range-based True Overlap: (candidateStart < bookingEnd) && (candidateEnd > bookingStart)
            const conflictingBooking = bookedIntervals.find(booking => 
                (candidateStartMins < booking.endMins) && (candidateEndMins > booking.startMins)
            );

            const existingApp = conflictingBooking?.appointment;
            const existingStatus = conflictingBooking?.status;

            const slotExactUTC = getSlotExactUTC(date, slotTime, doctorTimezone);
            const bookingCutoffMs = getBookingCutoffMs(slotExactUTC, slotDuration);
            const isCutoffPassed = now.getTime() >= bookingCutoffMs;
            const isSlotStarted = now.getTime() >= slotExactUTC.getTime();
            const isOngoing = isSlotStarted && !isCutoffPassed;
            const remainingMinutes = isOngoing 
                ? getRemainingSlotMinutes(slotExactUTC, slotDuration, now) 
                : slotDuration;
            const graceMinutes = getLateJoinGraceMinutes(slotDuration);

            const slotOverride = overrideMap.get(slotTime.trim().toUpperCase()) || overrideMap.get(slotTime.trim());

            let status;
            let breakReason = null;
            if (isCutoffPassed) {
                status = 'past';
            } else if (existingStatus === 'locked') {
                status = 'locked';
            } else if (existingStatus) {
                status = 'booked';
            } else if (slotOverride) {
                status = slotOverride.status || 'unavailable';
                breakReason = slotOverride.reason || 'Doctor on break';
            } else {
                status = 'available';
            }

            const bookedChannel = existingApp 
                ? ((existingApp.consultationType === 'offline' || existingApp.consultationType === 'physical') ? 'offline' : 'online') 
                : null;

            return { 
                time: slotTime, 
                startTimeUTC: slotExactUTC.toISOString(),
                endTimeUTC: new Date(slotExactUTC.getTime() + slotDuration * 60000).toISOString(),
                status, 
                type: slotType,
                bookedType: bookedChannel,
                available: status === 'available', 
                isLocked: status === 'locked',
                isBreak: status === 'unavailable' || status === 'break' || status === 'closed',
                breakReason,
                lockedBy: existingApp?.lockedBy || null,
                razorpayOrderId: existingApp?.razorpayOrderId || null,
                appointmentId: existingApp?._id || null,
                isBookable: status === 'available',
                isExpired: isCutoffPassed,
                isOngoing,
                remainingMinutes,
                graceMinutes,
                bookingCutoffMs,
                isFollowUpOnly: false,
                shiftIndex,
                shiftName,
                shiftStart,
                shiftEnd,
                shiftType
            };
        });

        const availableSlots = allSlotsWithStatus
            .filter(s => s.status === 'available')
            .map(s => s.time);

        res.status(200).json({
            success: true,
            doctorWorking: true,
            doctorTimezone,
            slots: availableSlots,
            allSlots: allSlotsWithStatus
        });

    } catch (error) {
        console.error("Get Available Slots Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const lockAppointmentSlot = async (req, res) => {
    try {
        const patientId = req.user.id || req.user._id;
        const { doctorId, date, time, consultationType, patientType, notes } = req.body;

        if (!patientId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        let doctor = await Doctor.findById(doctorId);
        let resolvedDoctorId = doctorId;
        if (!doctor) {
            const sharedUser = await SharedUser.findById(doctorId);
            if (sharedUser && sharedUser.profileId) {
                doctor = await Doctor.findById(sharedUser.profileId);
                if (doctor) {
                    resolvedDoctorId = doctor._id;
                }
            }
        }
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found" });
        }

        const channel = (consultationType === 'offline' || consultationType === 'physical') ? 'offline' : 'online';
        const fee = channel === 'offline'
            ? (doctor.consultationSettings?.offline?.fee ?? doctor.consultationSettings?.physical?.fee ?? 0)
            : (doctor.consultationSettings?.online?.fee ?? doctor.consultationSettings?.video?.fee ?? 0);

        // Check if the doctor has marked this slot as on break or closed
        const lockPossibleDoctorIds = [resolvedDoctorId];
        if (doctor && doctor._id && !lockPossibleDoctorIds.some(id => String(id) === String(doctor._id))) {
            lockPossibleDoctorIds.push(doctor._id);
        }
        const lockDoctorSharedUser = await SharedUser.findOne({ profileId: doctor._id || resolvedDoctorId });
        if (lockDoctorSharedUser && !lockPossibleDoctorIds.some(id => String(id) === String(lockDoctorSharedUser._id))) {
            lockPossibleDoctorIds.push(lockDoctorSharedUser._id);
        }

        const isOverridden = await DoctorSlotOverride.findOne({
            doctorId: { $in: lockPossibleDoctorIds },
            date: date,
            time: { $regex: new RegExp(`^${time.trim()}$`, 'i') }
        });
        if (isOverridden) {
            return res.status(400).json({
                success: false,
                message: `This slot is currently unavailable (${isOverridden.reason || 'Doctor on break'}). Please choose another slot.`
            });
        }

        const lockData = {
            doctorId: resolvedDoctorId,
            patientId,
            appointmentDate: date,
            appointmentTime: time,
            consultationType: channel,
            patientType: patientType || 'NEW',
            slotDuration: doctor.slotDuration || 15,
            doctorTimezone: getDoctorTimezone(doctor),
            patientTimezone: req.body.patientTimezone || req.headers['x-timezone'] || null,
            fee,
            notes
        };

        const lockedAppointment = await lockSlotUseCase.execute(lockData);

        res.status(200).json({
            success: true,
            message: "Slot locked successfully",
            id: lockedAppointment._id,
            appointmentId: lockedAppointment._id,
            data: {
                id: lockedAppointment._id,
                appointmentId: lockedAppointment._id,
                doctorId: lockedAppointment.doctorId,
                date: new Date(lockedAppointment.appointmentDate).toISOString().split('T')[0],
                time: lockedAppointment.appointmentTime,
                status: "Locked",
                lockExpiryTime: lockedAppointment.lockExpiryTime,
                razorpayOrderId: lockedAppointment.razorpayOrderId
            }
        });
    } catch (error) {
        console.error("Lock Slot Error:", error);

        if (error.code === 'SLOT_ALREADY_LOCKED') {
            return res.status(409).json({ success: false, code: error.code, message: error.message });
        }

        res.status(400).json({ success: false, message: error.message });
    }
};

export const unlockAppointmentSlot = async (req, res) => {
    try {
        const patientId = req.user.id || req.user._id;
        const { appointmentId, doctorId, date, time } = req.body;

        if (!patientId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        const payload = appointmentId || { doctorId, date, time };
        const unlockedAppointment = await unlockSlotUseCase.execute(payload, patientId);

        res.status(200).json({ success: true, message: "Slot unlocked successfully", appointment: unlockedAppointment });
    } catch (error) {
        console.error("Unlock Slot Error:", error);
        res.status(400).json({ success: false, message: error.message });
    }
};

export const extendAppointmentLock = async (req, res) => {
    try {
        const patientId = req.user.id || req.user._id;
        const { slotId } = req.body;

        if (!patientId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        if (!slotId) {
            return res.status(400).json({ success: false, message: "Slot ID is required" });
        }

        const extendedAppointment = await extendSlotLockUseCase.execute(slotId, patientId);

        res.status(200).json({
            success: true,
            message: "Slot lock extended successfully",
            lockExpiryTime: extendedAppointment.lockExpiryTime
        });
    } catch (error) {
        console.error("Extend Slot Lock Error:", error);
        res.status(400).json({ success: false, message: error.message, code: error.code });
    }
};

export const getAllAppointmentsAdmin = async (req, res) => {
    try {
        const appointments = await getAllAppointmentsAdminUseCase.execute();
        res.status(200).json({ success: true, appointments });
    } catch (error) {
        console.error("Get All Appointments Admin Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Task 1: POST /api/appointments/:id/cancel
 * Patient Cancellation with Auto-Refund (12-Hour Rule)
 */
export const cancelAppointment = async (req, res) => {
    try {
        const { id } = req.params;
        const patientId = req.user.id || req.user._id;

        if (!patientId) {
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }

        const appointment = await Appointment.findById(id);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        // Only the patient who booked may cancel
        if (appointment.patientId.toString() !== patientId.toString()) {
            return res.status(403).json({ success: false, message: "You are not authorized to cancel this appointment." });
        }

        // Only scheduled appointments can be cancelled
        if (appointment.status !== 'scheduled') {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel appointment with status '${appointment.status}'. Only 'scheduled' appointments can be cancelled.`
            });
        }

        // Handle direct doctor cancellation of manual bookings (no refund needed, zero commission)
        if (appointment.isManualBooking) {
            appointment.status = 'cancelled-by-doctor';
            appointment.cancellationReason = req.body.reason || 'Cancelled by doctor';
            appointment.cancelledAt = new Date();
            // Prune dead operational state
            appointment.lockedBy = undefined;
            appointment.lockExpiryTime = undefined;
            appointment.roomId = undefined;
            appointment.offlineOTP = undefined;
            appointment.lateJoinCutoffAt = undefined;
            await appointment.save();
            return res.status(200).json({
                success: true,
                message: "Manual appointment cancelled successfully. The slot is now free.",
                appointment
            });
        }

        // Calculate appointment scheduled start time
        const dateStr = appointment.appointmentDate ? new Date(appointment.appointmentDate).toISOString().split('T')[0] : null;
        const appointmentStartUTC = appointment.scheduledStartAt
            ? new Date(appointment.scheduledStartAt)
            : getSlotExactUTC(dateStr, appointment.appointmentTime);

        const now = new Date();
        const diffMs = appointmentStartUTC.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        // Strict 12-Hour Rule: current time must be strictly greater than 12 hours before scheduledStartAt
        if (diffHours <= 12) {
            return res.status(400).json({
                success: false,
                code: "CANCELLATION_WINDOW_CLOSED",
                message: "Appointments can only be cancelled strictly more than 12 hours prior to the scheduled time."
            });
        }

        // Trigger Razorpay Auto-Refund API
        let refundResult = null;
        if (appointment.paymentId && appointment.fee > 0) {
            try {
                refundResult = await razorpayRefund(appointment.paymentId, appointment.fee, {
                    notes: {
                        reason: req.body.reason || 'Patient 12h cancellation',
                        appointmentId: appointment._id.toString()
                    }
                });
                console.log(`[cancelAppointment] Refund successful for appointment ${appointment._id}:`, refundResult?.id);
            } catch (refundErr) {
                console.error(`[cancelAppointment] Razorpay refund API failed:`, refundErr);
                return res.status(500).json({
                    success: false,
                    message: "Failed to process automatic refund with Razorpay. Cancellation aborted. Please try again or contact support."
                });
            }
        }

        // Update appointment status to 'cancelled' and paymentStatus to 'refunded'
        appointment.status = 'cancelled';
        appointment.paymentStatus = 'refunded';
        appointment.cancellationReason = req.body.reason || 'Cancelled by patient (>12h before appointment)';
        appointment.cancelledAt = new Date();
        appointment.refundedAt = new Date();
        if (refundResult?.id) {
            appointment.refundId = refundResult.id;
            appointment.refundAmount = appointment.fee;
        }

        // Cleanly prune dead operational state while strictly retaining audit/financial records
        appointment.lockedBy = undefined;
        appointment.lockExpiryTime = undefined;
        appointment.roomId = undefined;
        appointment.offlineOTP = undefined;
        appointment.lateJoinCutoffAt = undefined;

        await appointment.save();

        // Cancel doctor's transaction payout (mark Transaction status as 'refunded')
        try {
            await Transaction.findOneAndUpdate(
                { appointmentId: appointment._id },
                { $set: { status: 'refunded' } }
            );
            console.log(`[cancelAppointment] Linked transaction for ${appointment._id} marked as refunded.`);
        } catch (txErr) {
            console.error(`[cancelAppointment] Error updating transaction status for ${appointment._id}:`, txErr);
        }

        // Trigger notifications
        try {
            // Patient notification
            await createNotificationUseCase.execute({
                recipientId: appointment.patientId,
                recipientModel: 'User',
                type: 'APPOINTMENT_CANCELLED',
                title: 'Appointment Cancelled & Refunded',
                message: `Your appointment on ${new Date(appointment.appointmentDate).toDateString()} at ${appointment.appointmentTime} has been cancelled. A 100% refund of ₹${appointment.fee} has been issued.`,
                referenceId: appointment._id
            });

            // Doctor notification
            await createNotificationUseCase.execute({
                recipientId: appointment.doctorId,
                recipientModel: 'Doctor',
                type: 'APPOINTMENT_CANCELLED',
                title: 'Appointment Cancelled by Patient',
                message: `Patient cancelled their appointment scheduled for ${new Date(appointment.appointmentDate).toDateString()} at ${appointment.appointmentTime}. Slot is now open.`,
                referenceId: appointment._id
            });
        } catch (notifErr) {
            console.error(`[cancelAppointment] Notification error:`, notifErr);
        }

        res.status(200).json({
            success: true,
            message: "Appointment cancelled successfully. A full refund has been initiated to your original payment method.",
            appointment
        });
    } catch (error) {
        console.error("Cancel Appointment Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const markNoShowOffline = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id || req.user._id;

        if (req.user?.role !== 'doctor') {
            return res.status(403).json({ success: false, message: "Forbidden. Only doctors can mark no-shows manually." });
        }

        const sharedUser = await SharedUser.findById(userId);
        const doctorProfileId = sharedUser?.profileId;

        const appointment = await Appointment.findById(id);
        if (!appointment) return res.status(404).json({ success: false, message: "Appointment not found." });

        const isAuthorized =
            (doctorProfileId && appointment.doctorId.toString() === doctorProfileId.toString()) ||
            (appointment.doctorId.toString() === userId.toString());

        if (!isAuthorized) {
            return res.status(403).json({ success: false, message: "Not authorized for this appointment." });
        }

        if (!['offline', 'physical'].includes(appointment.consultationType)) {
            return res.status(400).json({ success: false, message: "Only offline appointments can be marked no-show manually." });
        }

        if (appointment.status !== 'scheduled') {
            return res.status(400).json({ success: false, message: `Cannot mark no-show. Status is already ${appointment.status}.` });
        }

        // Must be past scheduled end time
        let endAt = appointment.scheduledEndAt ? new Date(appointment.scheduledEndAt) : null;
        if (!endAt || isNaN(endAt.getTime())) {
            if (appointment.scheduledStartAt) {
                endAt = new Date(new Date(appointment.scheduledStartAt).getTime() + 15 * 60000);
            }
        }

        if (endAt && !isNaN(endAt.getTime()) && new Date() < endAt) {
            return res.status(400).json({ success: false, message: "Cannot mark no-show before the scheduled end time." });
        }

        appointment.status = 'no-show';
        appointment.noShowMarkedAt = new Date();
        await appointment.save();

        res.status(200).json({ success: true, message: "Patient marked as no-show successfully.", appointment });
    } catch (error) {
        console.error("Mark No Show Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Task 3: POST /api/appointments/:id/dispute
 * Patient reports doctor absence for past offline 'no-show' appointments.
 */
export const disputeAppointment = async (req, res) => {
    try {
        const { id } = req.params;
        const patientId = req.user.id || req.user._id;

        if (!patientId) {
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }

        const appointment = await Appointment.findById(id);
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        // Verify patient ownership
        if (appointment.patientId.toString() !== patientId.toString()) {
            return res.status(403).json({ success: false, message: "You are not authorized to dispute this appointment." });
        }

        // Only offline appointments can be reported as doctor absence
        if (!['offline', 'physical'].includes(appointment.consultationType)) {
            return res.status(400).json({
                success: false,
                message: "Only in-person clinic appointments can be disputed through this process."
            });
        }

        // Must be marked as no-show
        if (appointment.status !== 'no-show') {
            return res.status(400).json({
                success: false,
                message: `Only appointments marked as 'no-show' can be disputed. Current status is '${appointment.status}'.`
            });
        }

        // Enforce 24-hour limit from scheduledEndAt
        const scheduledEndMs = appointment.scheduledEndAt 
            ? new Date(appointment.scheduledEndAt).getTime() 
            : (appointment.scheduledStartAt 
                ? new Date(appointment.scheduledStartAt).getTime() + 15 * 60000 
                : new Date(appointment.appointmentDate).getTime());
        
        const hoursSinceEnd = (Date.now() - scheduledEndMs) / (1000 * 60 * 60);
        if (hoursSinceEnd > 24) {
            return res.status(400).json({
                success: false,
                message: "The 24-hour window from the scheduled end time to report an issue for this appointment has expired."
            });
        }

        appointment.status = 'disputed';
        appointment.disputeReason = req.body.reason || 'Doctor did not show up at clinic / clinic was closed.';
        if (req.body.proofUrl) {
            appointment.disputeProofUrl = req.body.proofUrl;
        }
        appointment.disputedAt = new Date();
        await appointment.save();

        // Notify Admin of new dispute
        try {
            const admin = await Admin.findOne();
            if (admin) {
                await createNotificationUseCase.execute({
                    recipientId: admin._id,
                    recipientModel: 'Admin',
                    type: 'DISPUTE_SUBMITTED',
                    title: 'New Refund Request / Dispute',
                    message: `Patient reported doctor no-show for offline appointment on ${new Date(appointment.appointmentDate).toDateString()}. Requires refund review.`,
                    referenceId: appointment._id
                });
            }
        } catch (notifErr) {
            console.error(`[disputeAppointment] Error notifying admin:`, notifErr);
        }

        res.status(200).json({
            success: true,
            message: "Dispute submitted successfully. Our admin team will review the issue and approve your refund shortly.",
            appointment
        });
    } catch (error) {
        console.error("Dispute Appointment Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Task 3: GET /api/admin/appointments/disputed
 * Admin queries all appointments currently marked 'disputed'
 */
export const getDisputedAppointmentsAdmin = async (req, res) => {
    try {
        const disputedAppointments = await appointmentRepo.findDisputedAppointments();
        res.status(200).json({ success: true, appointments: disputedAppointments });
    } catch (error) {
        console.error("Get Disputed Appointments Admin Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Task 3: POST /api/admin/appointments/:id/refund
 * Admin approves dispute and triggers Razorpay refund, cancelling doctor payout
 */
export const refundDisputedAppointmentAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const appointment = await Appointment.findById(id);

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        if (appointment.status === 'refunded' || appointment.paymentStatus === 'refunded') {
            return res.status(400).json({ success: false, message: "Appointment is already refunded." });
        }

        // Trigger Razorpay Refund API
        let refundResult = null;
        if (appointment.paymentId && appointment.fee > 0) {
            try {
                refundResult = await razorpayRefund(appointment.paymentId, appointment.fee, {
                    notes: {
                        reason: req.body.notes || 'Admin dispute refund approval',
                        appointmentId: appointment._id.toString()
                    }
                });
                console.log(`[refundDisputedAppointmentAdmin] Refund successful for ${appointment._id}:`, refundResult?.id);
            } catch (refundErr) {
                console.error(`[refundDisputedAppointmentAdmin] Razorpay refund failed:`, refundErr);
                return res.status(500).json({
                    success: false,
                    message: "Failed to process Razorpay refund. Please check credentials or try again."
                });
            }
        }

        // Update appointment status to refunded
        appointment.status = 'refunded';
        appointment.paymentStatus = 'refunded';
        appointment.disputeResolvedAt = new Date();
        appointment.refundedAt = new Date();
        appointment.adminRefundNotes = req.body.notes || 'Refund approved by Admin after dispute investigation.';
        if (refundResult?.id) {
            appointment.refundId = refundResult.id;
            appointment.refundAmount = appointment.fee;
        }

        await appointment.save();

        // Cancel doctor payout in Transaction
        try {
            await Transaction.findOneAndUpdate(
                { appointmentId: appointment._id },
                { $set: { status: 'refunded' } }
            );
            console.log(`[refundDisputedAppointmentAdmin] Transaction marked as refunded for ${appointment._id}`);
        } catch (txErr) {
            console.error(`[refundDisputedAppointmentAdmin] Error updating transaction:`, txErr);
        }

        // Notify Patient & Doctor
        try {
            // Patient notification
            await createNotificationUseCase.execute({
                recipientId: appointment.patientId,
                recipientModel: 'User',
                type: 'REFUND_APPROVED',
                title: 'Refund Approved',
                message: `Your refund request for appointment on ${new Date(appointment.appointmentDate).toDateString()} has been approved. ₹${appointment.fee} refunded.`,
                referenceId: appointment._id
            });

            // Doctor notification
            await createNotificationUseCase.execute({
                recipientId: appointment.doctorId,
                recipientModel: 'Doctor',
                type: 'PAYOUT_CANCELLED',
                title: 'Offline Dispute Settled - Payout Cancelled',
                message: `The dispute for the appointment on ${new Date(appointment.appointmentDate).toDateString()} was settled in favor of the patient. The doctor payout has been cancelled.`,
                referenceId: appointment._id
            });
        } catch (notifErr) {
            console.error(`[refundDisputedAppointmentAdmin] Notification error:`, notifErr);
        }

        res.status(200).json({
            success: true,
            message: "Dispute approved and refund processed successfully via Razorpay.",
            appointment
        });
    } catch (error) {
        console.error("Refund Disputed Appointment Admin Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Doctor Slot Override Toggle
 * Allows doctor to mark a slot as unavailable / break, or reopen it.
 * POST /api/appointments/doctor/slot-override
 */
export const toggleDoctorSlotOverride = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }

        const sharedUser = await SharedUser.findById(userId);
        if (!sharedUser || !sharedUser.profileId) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }
        const doctorId = sharedUser.profileId;

        const { date, time, action, reason } = req.body;
        if (!date || !time || !action) {
            return res.status(400).json({
                success: false,
                message: "date, time, and action ('close' | 'open') are required."
            });
        }

        const trimmedDate = date.trim();
        const trimmedTime = time.trim();

        if (action === 'close' || action === 'unavailable' || action === 'break') {
            // Validate there is no existing active booked appointment
            const { startOfDayUTC, endOfDayUTC } = getUTCDayBounds(trimmedDate);
            const activeBooking = await Appointment.findOne({
                doctorId: { $in: [doctorId, sharedUser._id] },
                appointmentDate: { $gte: startOfDayUTC, $lte: endOfDayUTC },
                appointmentTime: trimmedTime,
                status: { $in: ['scheduled', 'locked'] }
            });

            if (activeBooking) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot close this slot because an active booking or lock already exists. Please cancel the appointment first."
                });
            }

            const override = await DoctorSlotOverride.findOneAndUpdate(
                { doctorId, date: trimmedDate, time: trimmedTime },
                {
                    doctorId,
                    date: trimmedDate,
                    time: trimmedTime,
                    status: 'unavailable',
                    reason: reason?.trim() || 'Closed / On Break'
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            return res.status(200).json({
                success: true,
                message: `Slot at ${trimmedTime} marked as closed / on break.`,
                override
            });
        } else if (action === 'open' || action === 'available') {
            await DoctorSlotOverride.deleteMany({
                doctorId: { $in: [doctorId, sharedUser._id] },
                date: trimmedDate,
                time: trimmedTime
            });
            return res.status(200).json({
                success: true,
                message: `Slot at ${trimmedTime} reopened and is now available for patient bookings.`
            });
        } else {
            return res.status(400).json({
                success: false,
                message: "Invalid action. Allowed values are 'close' or 'open'."
            });
        }
    } catch (error) {
        console.error("toggleDoctorSlotOverride Error:", error);
        return res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Doctor Manual Slot Booking (Zero Commission, Strictly Offline)
 * Allows doctor to manually book a slot for patients contacting directly via Call/WhatsApp/Walk-in.
 * POST /api/appointments/doctor/manual-book
 */
export const manualBookSlotDoctor = async (req, res) => {
    try {
        const userId = req.user?.id || req.user?._id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }

        const sharedUser = await SharedUser.findById(userId);
        if (!sharedUser || !sharedUser.profileId) {
            return res.status(404).json({ success: false, message: "Doctor profile not found." });
        }
        const doctorId = sharedUser.profileId;
        const doctor = await Doctor.findById(doctorId);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor profile record not found." });
        }

        const { date, time, patientName, opNumber, patientPhone, patientType, fee, notes } = req.body;
        if (!date || !time || !patientName || !patientName.trim()) {
            return res.status(400).json({
                success: false,
                message: "Date, time, and patient name are required for manual booking."
            });
        }

        const trimmedDate = date.trim();
        const trimmedTime = time.trim();

        // 1. Ensure slot has no existing active scheduled or locked appointment
        const { startOfDayUTC, endOfDayUTC } = getUTCDayBounds(trimmedDate);
        const activeBooking = await Appointment.findOne({
            doctorId: { $in: [doctorId, sharedUser._id] },
            appointmentDate: { $gte: startOfDayUTC, $lte: endOfDayUTC },
            appointmentTime: trimmedTime,
            status: { $in: ['scheduled', 'locked'] }
        });

        if (activeBooking) {
            return res.status(400).json({
                success: false,
                message: "This slot is already booked or locked. Please choose an open slot."
            });
        }

        // 2. Clear any doctor break override on this slot
        await DoctorSlotOverride.deleteMany({
            doctorId: { $in: [doctorId, sharedUser._id] },
            date: trimmedDate,
            time: trimmedTime
        });

        // 3. Compute slot timings
        const doctorTimezone = getDoctorTimezone(doctor);
        const slotExactUTC = getSlotExactUTC(trimmedDate, trimmedTime, doctorTimezone);
        const slotDuration = Number(doctor.slotDuration) || 15;
        const scheduledEndAt = new Date(slotExactUTC.getTime() + slotDuration * 60000);

        // 4. Resolve consultation fee
        const resolvedFee = (fee !== undefined && fee !== null && !isNaN(Number(fee)))
            ? Number(fee)
            : (doctor.consultationSettings?.offline?.fee ?? doctor.consultationSettings?.physical?.fee ?? 0);

        // 5. Create the manual offline appointment (0% commission, outside platform)
        const appointment = new Appointment({
            doctorId,
            appointmentDate: startOfDayUTC,
            appointmentTime: trimmedTime,
            doctorTimezone,
            consultationType: 'offline', // Under the hood treated as direct
            patientType: patientType === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'NEW',
            status: 'scheduled',
            paymentStatus: 'direct',    // Doctor collected payment directly — no platform transaction
            bookedByDoctor: true,       // Identifies this as a doctor-initiated appointment
            fee: resolvedFee,
            adminCommission: 0, // Zero platform commission
            doctorAmount: 0, // No platform payout
            isManualBooking: true,
            bookingSource: 'manual',
            manualPatientDetails: {
                name: patientName.trim(),
                opNumber: opNumber?.trim() || '',
                phone: patientPhone?.trim() || '',
                notes: notes?.trim() || ''
            },
            notes: notes?.trim() || '',
            scheduledStartAt: slotExactUTC,
            scheduledEndAt
        });

        await appointment.save();

        console.log(`[manualBookSlotDoctor] Slot ${trimmedTime} on ${trimmedDate} manually booked for ${patientName.trim()} by Dr. ${doctorId}`);

        return res.status(201).json({
            success: true,
            message: `Slot at ${trimmedTime} successfully direct booked for ${patientName.trim()}.`,
            appointment
        });

    } catch (error) {
        console.error("manualBookSlotDoctor Error:", error);
        return res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

export const getAppointmentById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id || req.user?._id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }

        const appointment = await Appointment.findById(id).populate('patientId', 'firstName lastName googleName email profileId');
        
        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        const appointmentObj = appointment.toObject();
        // Fallback: If clinicalNotes / prescriptions / files are in ConsultationRecord, attach them
        if (!appointmentObj.clinicalNotes || !appointmentObj.prescriptions?.length) {
            const cr = await ConsultationRecord.findOne({ appointmentId: appointment._id })
                .select('clinicalNotes prescriptions consultationFiles')
                .lean();
            if (cr) {
                if (!appointmentObj.clinicalNotes) appointmentObj.clinicalNotes = cr.clinicalNotes || '';
                if (!appointmentObj.prescriptions?.length) appointmentObj.prescriptions = cr.prescriptions || [];
                if (!appointmentObj.consultationFiles?.length) appointmentObj.consultationFiles = cr.consultationFiles || [];
            }
        }

        // RBAC Isolation: Patients cannot view doctor private clinical observation notes
        if (req.user?.role !== 'doctor' && req.user?.role !== 'admin') {
            delete appointmentObj.clinicalNotes;
        }

        res.status(200).json({ success: true, appointment: appointmentObj });
    } catch (error) {
        console.error("Get Appointment By Id Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Doctor Clinical Console: Fetch critical patient details and past consultation history
 * Strictly protected for doctor role
 */
export const getClinicalContext = async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;

        if (!user || user.role !== 'doctor') {
            return res.status(403).json({ success: false, message: "Access denied. Doctor clinical privileges required." });
        }

        const appointment = await Appointment.findById(id).populate({
            path: 'patientId',
            select: 'email profileId googleName isProfileCompleted',
            populate: {
                path: 'profileId',
                model: 'Patient',
            }
        });

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        const patientUser = appointment.patientId;
        const patientProfile = patientUser?.profileId || {};

        const patientInfo = {
            name: `${patientProfile.firstName || ''} ${patientProfile.lastName || ''}`.trim() || patientUser?.googleName || "Patient",
            bloodGroup: patientProfile.bloodGroup || "Not specified",
            gender: patientProfile.gender || "Not specified",
            dateOfBirth: patientProfile.dateOfBirth || null,
            phone: patientProfile.phone || "",
            allergies: patientProfile.medicalHistory?.allergies || [],
            chronicConditions: patientProfile.medicalHistory?.chronicConditions || [],
            currentMedications: patientProfile.medicalHistory?.currentMedications || [],
            emergencyContact: patientProfile.emergencyContact || null,
        };

        // Fetch current appointment's ConsultationRecord (with fallback to embedded appointment fields)
        const currentRecord = await ConsultationRecord.findOne({ appointmentId: appointment._id }).lean();
        const currentClinicalNotes = currentRecord?.clinicalNotes ?? appointment.clinicalNotes ?? '';
        const currentPrescriptions = currentRecord?.prescriptions ?? appointment.prescriptions ?? [];
        const currentFiles = currentRecord?.consultationFiles ?? appointment.consultationFiles ?? [];

        // Fetch past consultation records & clinical notes for longitudinal context
        let pastConsultations = [];
        if (appointment.patientId?._id) {
            const pastAppts = await Appointment.find({
                patientId: appointment.patientId._id,
                _id: { $ne: appointment._id },
                status: { $in: ['completed', 'scheduled'] },
            })
            .populate('doctorId', 'firstName lastName specialty')
            .sort({ appointmentDate: -1 })
            .limit(10)
            .lean();

            const pastApptIds = pastAppts.map((p) => p._id);
            const pastRecords = await ConsultationRecord.find({ appointmentId: { $in: pastApptIds } }).lean();
            const pastRecordMap = new Map(pastRecords.map((r) => [r.appointmentId.toString(), r]));

            pastConsultations = pastAppts.map((past) => {
                const r = pastRecordMap.get(past._id.toString());
                return {
                    appointmentId: past._id,
                    date: past.appointmentDate,
                    time: past.appointmentTime,
                    doctorName: past.doctorId ? `Dr. ${past.doctorId.firstName || ''} ${past.doctorId.lastName || ''}`.trim() : 'Doctor',
                    specialty: past.doctorId?.specialty || 'General Practice',
                    clinicalNotes: r?.clinicalNotes ?? past.clinicalNotes ?? '',
                    prescriptions: r?.prescriptions ?? past.prescriptions ?? [],
                };
            });
        }

        res.status(200).json({
            success: true,
            patientInfo,
            pastConsultations,
            currentNotes: currentClinicalNotes,
            prescriptions: currentPrescriptions,
            files: currentFiles,
        });
    } catch (error) {
        console.error("Get Clinical Context Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Save / auto-save doctor clinical observation notes for this appointment
 */
export const saveClinicalNotes = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;
        const user = req.user;

        if (!user || user.role !== 'doctor') {
            return res.status(403).json({ success: false, message: "Access denied. Doctor privileges required." });
        }

        // Dual-write: update Appointment for complete backward compatibility
        const appointment = await Appointment.findByIdAndUpdate(
            id,
            { $set: { clinicalNotes: notes || '' } },
            { new: true }
        );

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        // Upsert into ConsultationRecord
        const consultationRecord = await ConsultationRecord.findOneAndUpdate(
            { appointmentId: appointment._id },
            {
                $set: {
                    clinicalNotes: notes || '',
                    doctorId: appointment.doctorId,
                    patientId: appointment.patientId,
                },
            },
            { upsert: true, new: true }
        );

        if (consultationRecord && (!appointment.consultationRecordId || !appointment.consultationRecordId.equals(consultationRecord._id))) {
            appointment.consultationRecordId = consultationRecord._id;
            await appointment.save();
        }

        res.status(200).json({ success: true, message: "Clinical notes saved", clinicalNotes: appointment.clinicalNotes });
    } catch (error) {
        console.error("Save Clinical Notes Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Save structured prescription JSON payload to database upon consultation completion / draft update
 */
export const savePrescriptions = async (req, res) => {
    try {
        const { id } = req.params;
        const { prescriptions } = req.body;
        const user = req.user;

        if (!user || user.role !== 'doctor') {
            return res.status(403).json({ success: false, message: "Access denied. Doctor privileges required." });
        }

        if (!Array.isArray(prescriptions)) {
            return res.status(400).json({ success: false, message: "Prescriptions must be an array." });
        }

        // Dual-write: update Appointment for complete backward compatibility
        const appointment = await Appointment.findByIdAndUpdate(
            id,
            { $set: { prescriptions } },
            { new: true }
        );

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        // Upsert into ConsultationRecord
        const consultationRecord = await ConsultationRecord.findOneAndUpdate(
            { appointmentId: appointment._id },
            {
                $set: {
                    prescriptions,
                    doctorId: appointment.doctorId,
                    patientId: appointment.patientId,
                },
            },
            { upsert: true, new: true }
        );

        if (consultationRecord && (!appointment.consultationRecordId || !appointment.consultationRecordId.equals(consultationRecord._id))) {
            appointment.consultationRecordId = consultationRecord._id;
            await appointment.save();
        }

        res.status(200).json({
            success: true,
            message: "Prescriptions saved successfully",
            prescriptions: appointment.prescriptions,
        });
    } catch (error) {
        console.error("Save Prescriptions Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

/**
 * Upload consultation file organized under appointment namespace
 */
export const uploadConsultationFile = async (req, res) => {
    try {
        const { id } = req.params;
        const file = req.file;
        const { category } = req.body;
        const user = req.user;

        if (!file) {
            return res.status(400).json({ success: false, message: "No file uploaded." });
        }

        const ext = file.originalname.split('.').pop()?.toLowerCase() || 'file';
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);

        const newFileItem = {
            id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            name: file.originalname,
            size: `${sizeMB} MB`,
            type: ext,
            category: category || (user.role === 'doctor' ? 'Clinical Document' : 'Patient Record'),
            uploadedBy: user.role === 'doctor' ? 'Doctor' : 'Patient',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            url: `/uploads/${file.filename}`,
        };

        // Dual-write: update Appointment for complete backward compatibility
        const appointment = await Appointment.findByIdAndUpdate(
            id,
            { $push: { consultationFiles: newFileItem } },
            { new: true }
        );

        if (!appointment) {
            return res.status(404).json({ success: false, message: "Appointment not found." });
        }

        // Upsert into ConsultationRecord
        const consultationRecord = await ConsultationRecord.findOneAndUpdate(
            { appointmentId: appointment._id },
            {
                $push: { consultationFiles: newFileItem },
                $setOnInsert: {
                    doctorId: appointment.doctorId,
                    patientId: appointment.patientId,
                },
            },
            { upsert: true, new: true }
        );

        if (consultationRecord && (!appointment.consultationRecordId || !appointment.consultationRecordId.equals(consultationRecord._id))) {
            appointment.consultationRecordId = consultationRecord._id;
            await appointment.save();
        }

        res.status(201).json({ success: true, file: newFileItem });
    } catch (error) {
        console.error("Upload Consultation File Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

