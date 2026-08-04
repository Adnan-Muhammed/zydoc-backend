export class LockSlot {
    constructor(appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    async execute(lockData) {
        if (!lockData.doctorId || !lockData.patientId || !lockData.appointmentDate || !lockData.appointmentTime) {
            throw new Error("Missing required fields for locking slot");
        }

        // Lock for 5 minutes
        lockData.lockExpiryTime = new Date(Date.now() + 5 * 60 * 1000);

        const lockedAppointment = await this.appointmentRepository.lockSlot(lockData);

        if (!lockedAppointment) {
            const error = new Error("Slot is already locked by someone else");
            error.code = "SLOT_ALREADY_LOCKED";
            throw error;
        }

        return lockedAppointment;
    }
}
