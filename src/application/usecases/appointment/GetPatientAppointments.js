export class GetPatientAppointments {
    constructor(appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    async execute(patientId) {
        if (!patientId) {
            throw new Error("Patient ID is required to fetch appointments.");
        }
        return await this.appointmentRepository.findByPatientIdWithDoctorDetails(patientId);
    }
}
