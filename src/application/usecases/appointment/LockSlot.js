import paymentService from "../../../infrastructure/services/PaymentService.js";

export class LockSlot {
    constructor(appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    async execute(lockData) {
        if (!lockData.doctorId || !lockData.patientId || !lockData.appointmentDate || !lockData.appointmentTime || !lockData.patientType) {
            throw new Error("Missing required fields for locking slot (including patientType)");
        }

        const parseTimeStr = (tStr) => {
            if (!tStr) return { h: 0, m: 0 };
            const [time, modifier] = tStr.trim().split(/\s+/);
            let [h, m] = time.split(':').map(Number);
            if (isNaN(h)) h = 0;
            if (isNaN(m)) m = 0;
            if (modifier) {
                if (modifier.toUpperCase() === 'PM' && h < 12) h += 12;
                if (modifier.toUpperCase() === 'AM' && h === 12) h = 0;
            }
            return { h, m };
        };

        const { h, m } = parseTimeStr(lockData.appointmentTime);
        let year, month, day;
        if (lockData.appointmentDate.includes('T')) {
            const dateObj = new Date(lockData.appointmentDate);
            year = dateObj.getFullYear();
            month = dateObj.getMonth() + 1;
            day = dateObj.getDate();
        } else {
            [year, month, day] = lockData.appointmentDate.split('-').map(Number);
        }
        
        const exactAppTime = new Date(year, month - 1, day, h, m, 0);
        const slotEndTime = new Date(exactAppTime.getTime() + 30 * 60000);
        
        if (slotEndTime <= new Date()) {
            const error = new Error("Cannot book a past time slot.");
            error.code = "SLOT_EXPIRED";
            throw error;
        }

        // Normalize patientType
        const normalizePatientType = (pt) => {
            const cleaned = String(pt || '').toLowerCase().replace(/[\s\-_]/g, '');
            return cleaned === 'followup' ? 'FOLLOW_UP' : 'NEW_CONSULTATION';
        };
        const patientTypeConst = normalizePatientType(lockData.patientType);

        // Calculate elapsed minutes
        const currentTime = new Date();
        const elapsedMinutes = (currentTime.getTime() - exactAppTime.getTime()) / (1000 * 60);

        // Time-based Booking Cut-off
        if (patientTypeConst === 'NEW_CONSULTATION' && elapsedMinutes > 10) {
            const error = new Error("Booking time expired for this slot.");
            error.code = "SLOT_EXPIRED";
            throw error;
        }
        
        if (patientTypeConst === 'FOLLOW_UP' && elapsedMinutes > 20) {
            const error = new Error("Booking time expired for this slot.");
            error.code = "SLOT_EXPIRED";
            throw error;
        }

        // Calculate and save late entry cutoff for JoinRoom
        if (patientTypeConst === 'NEW_CONSULTATION') {
            lockData.lateJoinCutoffAt = new Date(exactAppTime.getTime() + 15 * 60000);
        } else {
            lockData.lateJoinCutoffAt = new Date(exactAppTime.getTime() + 25 * 60000);
        }

        // Lock for 5 minutes
        lockData.lockExpiryTime = new Date(currentTime.getTime() + 5 * 60 * 1000);

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
        // Assuming fee is in INR, Razorpay expects amount in paise (multiply by 100)
        const amountInPaise = Math.round(lockData.fee * 100);
        const receiptId = `receipt_${Date.now()}_${lockedAppointment._id}`;
        
        try {
            const order = await paymentService.createOrder(amountInPaise, receiptId);
            lockedAppointment.razorpayOrderId = order.id;
            await this.appointmentRepository.update(lockedAppointment._id, { razorpayOrderId: order.id });
        } catch (error) {
            // If payment order creation fails, we might want to unlock the slot or log the error
            console.error("Failed to create Razorpay order during slot lock:", error);
            // Optionally remove the lock if order creation fails, to allow retry
            await this.appointmentRepository.unlockSlot(lockedAppointment._id, lockData.patientId);
            throw new Error("Failed to initialize payment for the slot");
        }

        return lockedAppointment;
    }
}
