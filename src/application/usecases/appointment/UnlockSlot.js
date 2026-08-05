export class UnlockSlot {
    constructor(appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    async execute(payload, userId) {
        if (!payload || !userId) {
            throw new Error("payload and userId are required");
        }

        const unlockedAppointment = await this.appointmentRepository.unlockSlot(payload, userId);

        if (!unlockedAppointment) {
            throw new Error("Failed to unlock slot. It may have expired or was locked by another user.");
        }

        return unlockedAppointment;
    }
}
 