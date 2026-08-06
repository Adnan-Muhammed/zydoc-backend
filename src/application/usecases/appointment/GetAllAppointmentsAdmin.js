export class GetAllAppointmentsAdmin {
    constructor(appointmentRepository) {
        this.appointmentRepository = appointmentRepository;
    }

    async execute() {
        return await this.appointmentRepository.findAllWithDetails();
    }
}
