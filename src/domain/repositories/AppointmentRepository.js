export class AppointmentRepository {
    async lockSlot(lockData) { throw new Error('Method not implemented'); }
    async unlockSlot(appointmentId, userId) { throw new Error('Method not implemented'); }
    async findExpiredLocks(currentTime) { throw new Error('Method not implemented'); }
}
 