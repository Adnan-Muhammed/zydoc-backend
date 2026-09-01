export class GetDoctorHistory {
    constructor(appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    async execute(doctorId) {
        if (!doctorId) {
            throw new Error("Doctor ID is required to fetch history appointments.");
        }
        return await this.appointmentRepository.findDoctorHistoryWithPatientDetails(doctorId);
    }
}
