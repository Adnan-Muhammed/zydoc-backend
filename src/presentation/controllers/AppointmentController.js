import Appointment from "../../infrastructure/database/models/Appointment.js";
import Doctor from "../../infrastructure/database/models/DoctorProfile.js";
import { LockSlot } from "../../application/usecases/appointment/LockSlot.js";
import { UnlockSlot } from "../../application/usecases/appointment/UnlockSlot.js";
import { GetPatientAppointments } from "../../application/usecases/appointment/GetPatientAppointments.js";
import { GetDoctorAppointments } from "../../application/usecases/appointment/GetDoctorAppointments.js";
import { GetAllAppointmentsAdmin } from "../../application/usecases/appointment/GetAllAppointmentsAdmin.js";
import { MongoAppointmentRepository } from "../../infrastructure/repositories/MongoAppointmentRepository.js";
import { fcmService } from "../../infrastructure/services/FcmService.js";
import { socketService } from "../../infrastructure/services/SocketService.js";

const appointmentRepo = new MongoAppointmentRepository();
const lockSlotUseCase = new LockSlot(appointmentRepo);
const unlockSlotUseCase = new UnlockSlot(appointmentRepo);
const getPatientAppointmentsUseCase = new GetPatientAppointments(appointmentRepo);
const getDoctorAppointmentsUseCase = new GetDoctorAppointments(appointmentRepo);
const getAllAppointmentsAdminUseCase = new GetAllAppointmentsAdmin(appointmentRepo);

// //Create a new appointment
// export const createAppointment = async (req, res) => {

//     console.log(8888888);

//     try {
//         const { doctorId, appointmentDate, appointmentTime, consultationType, fee, notes } = req.body;
//         // The authentication middleware should populate req.user
//         const patientId = req.user.id || req.user._id;

//         if (!patientId) {
//             return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
//         }

//         if (!doctorId || !appointmentDate || !appointmentTime || !consultationType || fee === undefined) {
//             return res.status(400).json({ success: false, message: "Missing required fields" });
//         }

//         const newAppointment = new Appointment({
//             patientId,
//             doctorId,
//             appointmentDate,
//             appointmentTime,
//             consultationType,
//             fee,
//             notes
//         });

//         await newAppointment.save();

//         // ─── Notification Routing: Socket.io (Online) vs FCM (OfflineFallback) ──
//         // Fire-and-forget: failure NEVER affects the booking response
//         try {
//             // Find the SharedUser account for this doctor to check connection status
//             // The SocketService registry uses SharedUser._id as the key
//             const doctorSharedUser = await SharedUser.findOne({
//                 profileId: doctorId,
//                 role: 'doctor'
//             }).select('_id');

//             // Format the notification payload
//             const patientUser = await SharedUser.findById(patientId).populate("profileId").select("profileId");
//             const patientFirstName = patientUser?.profileId?.firstName || "A patient";

//             const formattedDate = new Date(appointmentDate).toLocaleDateString("en-IN", {
//                 day: "numeric", month: "short", year: "numeric",
//             });

//             const notificationTitle = "📅 New Appointment Booked!";
//             const notificationBody = `${patientFirstName} booked a ${consultationType} consultation on ${formattedDate} at ${appointmentTime}.`;
//             const notificationLink = "/doctor/appointments";


//             if (doctorSharedUser && socketService.isUserOnline(doctorId)) {
//                 // DOCTOR IS ONLINE -> Send via Socket.io

//                 socketService.emitToUser(doctorId, "new_notification", {
//                     title: notificationTitle,
//                     message: notificationBody,
//                     link: notificationLink,
//                     type: "new_appointment",
//                     appointmentId: String(newAppointment._id),
//                     timestamp: new Date().toISOString()
//                 });


//                 console.log(111111);




//             } else {


//                 console.log(222222222);
//                 console.log(222222222);
//                 console.log(222222222);
//                 console.log(222222222);

//                 // DOCTOR IS OFFLINE -> Fallback to FCM Push Notification
//                 console.log(`[AppointmentController] Doctor ${doctorId} is OFFLINE. Falling back to FCM push notification.`);
//                 fs.appendFileSync('fcm_debug.log', `[${new Date().toISOString()}] OFFLINE -> FCM Push\n`);
//                 const doctorProfile = await Doctor.findById(doctorId).select("fcmToken");

//                 if (doctorProfile?.fcmToken) {
//                     await fcmService.sendToDevice(
//                         doctorProfile.fcmToken,
//                         {
//                             title: notificationTitle,
//                             body: notificationBody,
//                         },
//                         {
//                             appointmentId: String(newAppointment._id),
//                             type: "new_appointment",
//                             link: notificationLink,
//                         }
//                     );
//                 } else {

//                     console.log(33333333333);

//                     console.log(`[AppointmentController] Doctor ${doctorId} is offline and has no FCM token. Notification skipped.`);
//                 }
//             }
//         } catch (notifError) {
//             // Log but never fail the booking because of a notification error
//             console.error("[AppointmentController] Notification routing failed (non-critical):", notifError.message);
//         }
//         // ────────────────────────────────────────────────────────────────────────

//         res.status(201).json({ success: true, message: "Appointment booked successfully", appointment: newAppointment });
//     } catch (error) {
//         console.error("Create Appointment Error:", error);
//         res.status(500).json({ success: false, message: "Server error", error: error.message });
//     }
// };



// Get appointments for a specific patient
export const getPatientAppointments = async (req, res) => {
    try {
        const patientId = req.user.id || req.user._id;

        if (!patientId) {
            return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
        }

        const appointments = await getPatientAppointmentsUseCase.execute(patientId);

        res.status(200).json({ success: true, appointments });
    } catch (error) {
        console.error("Get Patient Appointments Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

import SharedUser from "../../infrastructure/database/models/SharedUser.js";

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

        const appointments = await getDoctorAppointmentsUseCase.execute(doctorId);

        res.status(200).json({ success: true, appointments });
    } catch (error) {
        console.error("Get Doctor Appointments Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};


export const getAvailableSlots = async (req, res) => {
    try {
        const { doctorId } = req.params;
        const { date, consultationType } = req.query; // e.g. "2026-07-15", "video"

        if (!date) {
            return res.status(400).json({ success: false, message: "Date is required" });
        }

        const doctor = await Doctor.findById(doctorId);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found" });
        }

        const isVideoEnabled = doctor.consultationSettings?.video?.enabled;
        const isPhysicalEnabled = doctor.consultationSettings?.physical?.enabled;

        if (consultationType === 'video' && !isVideoEnabled) {
            return res.status(400).json({ success: false, message: "Doctor does not offer online consultation." });
        }
        if (consultationType === 'physical' && !isPhysicalEnabled) {
            return res.status(400).json({ success: false, message: "Doctor does not offer in-person consultation." });
        }

        // ── 1. Resolve the day schedule ──────────────────────────────────────
        const [year, month, day] = date.split('-').map(Number);
        // Use UTC constructor so the date doesn't shift across timezones
        const selectedDate = new Date(Date.UTC(year, month - 1, day));

        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        // getDay() on a UTC date → use getUTCDay() to be consistent
        const dayOfWeek = dayNames[selectedDate.getUTCDay()];
        const isWeekday = selectedDate.getUTCDay() >= 1 && selectedDate.getUTCDay() <= 5;

        /**
         * Resolve working hours with BACKWARD COMPATIBILITY:
         *   - New format: workingHours.online / workingHours.offline  (nested)
         *   - Old format: workingHours.mondayToFriday / workingHours.saturday  (flat, direct keys)
         * Flat-format doctors like "ramees ali" have their schedule stored directly
         * on workingHours without the online/offline nesting added later in the schema.
         */
        const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'mondayToFriday'];
        const rawWH = doctor.workingHours || {};

        function resolveWorkingHours(consultationType) {
            const channelKey = consultationType === 'physical' ? 'offline' : 'online';
            const channelObj = rawWH[channelKey] || {};

            // Check if the channel object has actual day-level keys (new nested format)
            const channelHasDays = DAY_KEYS.some(k => channelObj[k]?.start !== undefined);
            if (channelHasDays) return channelObj;

            // Fall back: check if workingHours itself has day-level keys (old flat format)
            const flatHasDays = DAY_KEYS.some(k => rawWH[k]?.start !== undefined);
            if (flatHasDays) return rawWH;

            return {};
        }

        const workingHoursSettings = resolveWorkingHours(consultationType);

        const hasIndividualDaysActive = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
            .some(d => workingHoursSettings[d]?.active === true);

        // Priority: specific day → mondayToFriday block → MVP fallback
        let daySchedule = workingHoursSettings[dayOfWeek];

        if (!hasIndividualDaysActive && isWeekday && workingHoursSettings.mondayToFriday?.active) {
            daySchedule = workingHoursSettings.mondayToFriday;
        }

        // If the doctor has not configured anything at all, use a sensible default.
        // But if they HAVE a schedule and the day is explicitly inactive, return 0 slots.
        const hasAnyActiveDay = Object.values(workingHoursSettings).some(s => s?.active === true);


        if (!daySchedule || !daySchedule.active) {
            if (hasAnyActiveDay) {
                // Doctor configured their schedule but this day is marked closed
                return res.status(200).json({
                    success: true,
                    doctorWorking: false,
                    slots: [],
                    allSlots: []
                });
            }
            // Doctor has never set a schedule → MVP fallback (treat every weekday as 09:00-17:00)
            if (!isWeekday) {
                return res.status(200).json({
                    success: true,
                    doctorWorking: false,
                    slots: [],
                    allSlots: []
                });
            }
            daySchedule = { active: true, start: "09:00", end: "17:00" };
        }

        // ── 2. Generate 30-min slot strings ──────────────────────────────────
        const start = daySchedule.start || "09:00";
        const end = daySchedule.end || "17:00";

        const slots = [];
        const SLOT_DURATION = 30;
        const BUFFER = 10;
        const TOTAL_STEP = SLOT_DURATION + BUFFER;

        let [currentHour, currentMin] = start.split(':').map(Number);
        const [endHour, endMin] = end.split(':').map(Number);

        let currentTimeInMins = currentHour * 60 + currentMin;
        const endTimeInMins = endHour * 60 + endMin;

        while (currentTimeInMins + SLOT_DURATION <= endTimeInMins) {
            const h = Math.floor(currentTimeInMins / 60);
            const m = currentTimeInMins % 60;
            slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
            currentTimeInMins += TOTAL_STEP;
        }

        if (slots.length === 0) {
            return res.status(200).json({ success: true, doctorWorking: true, slots: [], allSlots: [] });
        }

        // ── 3. Fetch already-booked slots for this date ───────────────────────
        // Query using the ISO date string prefix so UTC storage doesn't drift ±1 day
        const startOfDayUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
        const endOfDayUTC = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

        const existingAppointments = await Appointment.find({
            doctorId,
            appointmentDate: { $gte: startOfDayUTC, $lte: endOfDayUTC },
            $or: [
                { status: { $in: ['scheduled', 'completed'] } },
                { status: 'locked', lockExpiryTime: { $gt: new Date() } }
            ]
        });

        // console.log("existingAppointments:", existingAppointments);

        // Use a Map to keep track of the specific status of each taken slot
        const slotStatusMap = new Map(existingAppointments.map(app => [app.appointmentTime, app.status]));

        // ── 4. Determine "now" in the same UTC reference ──────────────────────
        const now = new Date();
        const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const isToday = selectedDate.getTime() === todayUTC.getTime();
        const isFutureDate = selectedDate.getTime() > todayUTC.getTime();

        // ── 5. Build enriched slot list with 3-state status ──────────────────
        const allSlotsWithStatus = slots.map(slot => {
            const existingStatus = slotStatusMap.get(slot);

            let slotPast = false;
            if (!isFutureDate) {
                if (!isToday) {
                    // Entirely past day
                    slotPast = true;
                } else {
                    // Today: compare slot time to current UTC time
                    const [slotH, slotM] = slot.split(':').map(Number);
                    const slotUTC = new Date(Date.UTC(
                        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
                        slotH, slotM, 0, 0
                    ));
                    slotPast = slotUTC.getTime() <= now.getTime();
                }
            }

            let status;
            if (slotPast) status = 'Past';
            else if (existingStatus === 'locked') status = 'Locked';
            else if (existingStatus) status = 'Booked';
            else status = 'Available';

            return { time: slot, status, available: status === 'Available', isLocked: status === 'Locked' };
        });

        const availableSlots = allSlotsWithStatus
            .filter(s => s.status === 'available')
            .map(s => s.time);

        res.status(200).json({
            success: true,
            doctorWorking: true,
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
        const { doctorId, date, time, consultationType, notes } = req.body;

        if (!patientId) {
            return res.status(401).json({ success: false, message: "Unauthorized." });
        }

        // Fetch the doctor to determine the correct fee for the consultation type
        const doctor = await Doctor.findById(doctorId);
        if (!doctor) {
            return res.status(404).json({ success: false, message: "Doctor not found" });
        }

        const fee = consultationType === 'physical'
            ? doctor.consultationSettings?.physical?.fee || 0
            : doctor.consultationSettings?.video?.fee || 0;

        const lockData = {
            doctorId,
            patientId,
            appointmentDate: date,
            appointmentTime: time,
            consultationType,
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
                lockExpiryTime: lockedAppointment.lockExpiryTime
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
        // Support either appointmentId OR the fields from the frontend
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

export const getAllAppointmentsAdmin = async (req, res) => {
    try {
        const appointments = await getAllAppointmentsAdminUseCase.execute();
        res.status(200).json({ success: true, appointments });
    } catch (error) {
        console.error("Get All Appointments Admin Error:", error);
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

