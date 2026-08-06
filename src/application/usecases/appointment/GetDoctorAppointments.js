export class GetDoctorAppointments {
    constructor(appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    async execute(doctorId) {
        if (!doctorId) {
            throw new Error("Doctor ID is required to fetch appointments.");
        }
        return await this.appointmentRepository.findByDoctorIdWithPatientDetails(doctorId);
    }
}
