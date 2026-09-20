export class AppointmentRepository {
    async lockSlot(lockData) { throw new Error('Method not implemented'); }
    async unlockSlot(appointmentId, userId) { throw new Error('Method not implemented'); }
    async expireLockedSlot(appointmentId) { throw new Error('Method not implemented'); }
    async findExpiredLocks(currentTime) { throw new Error('Method not implemented'); }
    async findByPatientIdWithDoctorDetails(patientId) { throw new Error('Method not implemented'); }
    async findByDoctorIdWithPatientDetails(doctorId) { throw new Error('Method not implemented'); }
    async lazyUpdateNoShows(filter = {}) { throw new Error('Method not implemented'); }
    async getAdminAppointments(filters, options) { throw new Error('Method not implemented'); }
    async getAdminAppointmentById(id) { throw new Error('Method not implemented'); }
    async getAdminAppointmentStats() { throw new Error('Method not implemented'); }
}
