// src/application/usecases/admin/GetAdminAppointmentStatsUseCase.js

/**
 * ── Get Admin Appointment Stats Use Case ───────────────────────────────────────
 * Aggregates consultation metrics across statuses (completed, ongoing, pending,
 * cancelled, refunded) and financial volume/commission for Admin overview cards.
 */
export class GetAdminAppointmentStatsUseCase {
  constructor(appointmentRepository) {
    this.appointmentRepository = appointmentRepository;
  }

  async execute() {
    return await this.appointmentRepository.getAdminAppointmentStats();
  }
}
