import paymentService from "../../../infrastructure/services/PaymentService.js";
import { 
    getSlotExactUTC, 
    getLateJoinGraceMinutes, 
    getBookingCutoffMs, 
    getRemainingSlotMinutes 
} from "../../../infrastructure/utils/timeUtils.js";

export class LockSlot {
    constructor(appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    async execute(lockData) {
        if (!lockData.doctorId || !lockData.patientId || !lockData.appointmentDate || !lockData.appointmentTime) {
            throw new Error("Missing required fields for locking slot");
        }

        const slotDuration = Number(lockData.slotDuration) || 15;
        const doctorTimezone = lockData.doctorTimezone || lockData.timezone || 'Asia/Kolkata';
        const slotExactUTC = getSlotExactUTC(lockData.appointmentDate, lockData.appointmentTime, doctorTimezone);
        const slotEndUTC = new Date(slotExactUTC.getTime() + slotDuration * 60000);
        const now = new Date();

        // Dynamic Cutoff Validation:
        // - Short slots (<= 15m): Must be booked at least 3m before start
        // - Long slots (> 15m): Allowed in-progress up until late-join grace period
        const bookingCutoffMs = getBookingCutoffMs(slotExactUTC, slotDuration);
        if (now.getTime() >= bookingCutoffMs) {
            const error = new Error("The booking window for this time slot has closed.");
            error.code = "SLOT_EXPIRED";
            throw error;
        }

        // Normalize patientType
        const normalizePatientType = (pt) => {
            const cleaned = String(pt || '').toLowerCase().replace(/[\s\-_]/g, '');
            return cleaned === 'followup' ? 'FOLLOW_UP' : 'NEW';
        };
        const patientTypeConst = normalizePatientType(lockData.patientType);

        const isOngoing = now.getTime() > slotExactUTC.getTime();
        const graceMinutes = getLateJoinGraceMinutes(slotDuration);

        // Standardize timestamps
        lockData.patientType = patientTypeConst;
        lockData.scheduledStartAt = slotExactUTC;
        lockData.scheduledEndAt = slotEndUTC;
        lockData.doctorTimezone = doctorTimezone;
        lockData.patientTimezone = lockData.patientTimezone || null;

        // Proportional late join cutoff
        lockData.lateJoinCutoffAt = new Date(slotExactUTC.getTime() + graceMinutes * 60 * 1000);

        // In-progress metadata & dynamic payment lock window
        lockData.isInProgressBooking = isOngoing;
        if (isOngoing) {
            lockData.effectiveBookedDuration = getRemainingSlotMinutes(slotExactUTC, slotDuration, now);
            // Quick 3-minute payment lock for ongoing slots
            lockData.lockExpiryTime = new Date(now.getTime() + 3 * 60 * 1000);
        } else {
            lockData.effectiveBookedDuration = slotDuration;
            // Standard 5-minute payment lock
            lockData.lockExpiryTime = new Date(now.getTime() + 5 * 60 * 1000);
        }

        const lockedAppointment = await this.appointmentRepository.lockSlot(lockData);

        if (!lockedAppointment) {
            const error = new Error("Slot is already locked by someone else");
            error.code = "SLOT_ALREADY_LOCKED";
            throw error;
        }

        // If the slot is already locked by the same user and has a razorpayOrderId, return it
        if (lockedAppointment.razorpayOrderId) {
            return lockedAppointment;
        }

        // Generate Razorpay order for new lock
        const amountInPaise = Math.round(lockData.fee * 100);
        const receiptId = `receipt_${Date.now()}_${lockedAppointment._id}`;
        
        try {
            const order = await paymentService.createOrder(amountInPaise, receiptId);
            lockedAppointment.razorpayOrderId = order.id;
            await this.appointmentRepository.update(lockedAppointment._id, { razorpayOrderId: order.id });
        } catch (error) {
            console.error("Failed to create Razorpay order during slot lock:", error);
            await this.appointmentRepository.unlockSlot(lockedAppointment._id, lockData.patientId);
            throw new Error("Failed to initialize payment for the slot");
        }

        return lockedAppointment;
    }
}

