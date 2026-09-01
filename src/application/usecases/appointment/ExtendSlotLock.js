export class ExtendSlotLock {
    constructor(appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    async execute(slotId, userId) {
        if (!slotId || !userId) {
            throw new Error("Missing required fields: slotId and userId");
        }

        // Extend the lock by 2 minutes
        const extendedAppointment = await this.appointmentRepository.extendLock(slotId, userId, 2);

        if (!extendedAppointment) {
            const error = new Error("Slot lock not found or already expired");
            error.code = "LOCK_NOT_FOUND_OR_EXPIRED";
            throw error;
        }

        return extendedAppointment;
    }
}
