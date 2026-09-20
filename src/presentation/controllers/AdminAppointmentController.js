// src/presentation/controllers/AdminAppointmentController.js

/**
 * ── Admin Appointment Controller ───────────────────────────────────────────────
 * Presentation layer controller for administrative appointment/consultation queries.
 * Thin controller following Clean Architecture: validates input, delegates to UseCases,
 * formats response for the frontend data table.
 */
export class AdminAppointmentController {
  constructor(
    getAdminAppointmentsUseCase,
    getAdminAppointmentStatsUseCase = null,
    appointmentRepository = null
  ) {
    this.getAdminAppointmentsUseCase = getAdminAppointmentsUseCase;
    this.getAdminAppointmentStatsUseCase = getAdminAppointmentStatsUseCase;
    this.appointmentRepository = appointmentRepository;
  }

  // ── GET /api/admin/appointments ─────────────────────────────────────────────
  /**
   * Fetches master list of consultations with robust filtering and search.
   *
   * Query params:
   *  - status:      pending | ongoing | completed | cancelled | refunded | ALL
   *  - type:        online | offline | ALL
   *  - startDate:   ISO date string (YYYY-MM-DD)
   *  - endDate:     ISO date string (YYYY-MM-DD)
   *  - search:      Patient Name or Doctor Name
   *  - patientName: Filter by specific patient name
   *  - doctorName:  Filter by specific doctor name
   *  - page:        Page number (default: 1)
   *  - limit:       Items per page (default: 20, max: 100)
   *  - sort:        newest (default) | oldest | fee_high | fee_low
   */
  async getAppointments(req, res) {
    try {
      const filters = {
        status: req.query.status,
        type: req.query.type,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        search: req.query.search,
        patientName: req.query.patientName,
        doctorName: req.query.doctorName,
      };

      const options = {
        page: req.query.page || 1,
        limit: req.query.limit || 20,
        sortBy: req.query.sort || req.query.sortBy || "newest",
      };

      const result = await this.getAdminAppointmentsUseCase.execute(filters, options);

      return res.status(200).json({
        success: true,
        message: `${result.total} consultation(s) found.`,
        ...result,
      });
    } catch (error) {
      console.error("[getAppointments] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to fetch consultation records.",
      });
    }
  }

  // ── GET /api/admin/appointments/stats ───────────────────────────────────────
  /**
   * Aggregate stats across all consultations (volumes, statuses, platform revenue).
   */
  async getAppointmentStats(req, res) {
    try {
      if (!this.getAdminAppointmentStatsUseCase) {
        return res.status(501).json({
          success: false,
          message: "Appointment stats use case not configured.",
        });
      }

      const stats = await this.getAdminAppointmentStatsUseCase.execute();

      return res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("[getAppointmentStats] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to fetch appointment statistics.",
      });
    }
  }

  // ── GET /api/admin/appointments/:id ─────────────────────────────────────────
  /**
   * Fetches single appointment details by ID.
   */
  async getAppointmentById(req, res) {
    try {
      const { id } = req.params;

      if (!this.appointmentRepository) {
        return res.status(501).json({
          success: false,
          message: "Appointment repository not configured for detail lookup.",
        });
      }

      const appointment = await this.appointmentRepository.getAdminAppointmentById(id);

      return res.status(200).json({
        success: true,
        appointment,
      });
    } catch (error) {
      console.error("[getAppointmentById] Error:", error.message);
      const status = error.statusCode || (error.message.includes("not found") ? 404 : 500);
      return res.status(status).json({
        success: false,
        message: error.message || "Failed to fetch appointment record.",
      });
    }
  }
}
