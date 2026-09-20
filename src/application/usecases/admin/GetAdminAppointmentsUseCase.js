// src/application/usecases/admin/GetAdminAppointmentsUseCase.js

/**
 * ── Get Admin Appointments Use Case ───────────────────────────────────────────
 * Fetches master list of all consultations across online and offline types.
 *
 * Supports:
 *  - Filtering: status (pending, ongoing, completed, cancelled, refunded),
 *               type (online, offline),
 *               date range (startDate, endDate)
 *  - Search: Patient Name or Doctor Name
 *  - Full population: patient and doctor summary data
 *  - Pagination & sorting (latest first)
 */
export class GetAdminAppointmentsUseCase {
  constructor(appointmentRepository) {
    this.appointmentRepository = appointmentRepository;
  }

  /**
   * @param {object} filters - { status, type, startDate, endDate, search, patientName, doctorName }
   * @param {object} options - { page, limit, sortBy }
   * @returns {Promise<{ appointments: object[], total: number, page: number, limit: number, totalPages: number }>}
   */
  async execute(filters = {}, options = {}) {
    return await this.appointmentRepository.getAdminAppointments(filters, options);
  }
}
