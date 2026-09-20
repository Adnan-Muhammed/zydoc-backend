// src/presentation/controllers/AdminPatientController.js

export class AdminPatientController {
  constructor(getPatientsUseCase, getPatientStatsUseCase, userRepository = null) {
    this.getPatientsUseCase = getPatientsUseCase;
    this.getPatientStatsUseCase = getPatientStatsUseCase;
    this.userRepository = userRepository;
  }

  async getPatients(req, res) {
    try {
      const filters = {
        search: req.query.search,
        status: req.query.status || req.query.accountStatus,
        gender: req.query.gender,
      };
      const options = {
        page: req.query.page || 1,
        limit: req.query.limit || 20,
        sortBy: req.query.sort || req.query.sortBy || "newest",
      };
      const result = await this.getPatientsUseCase.execute(filters, options);
      return res.status(200).json({
        success: true,
        message: `${result.total} registered patient(s) found.`,
        ...result,
      });
    } catch (error) {
      console.error("[getPatients] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to fetch patient list.",
      });
    }
  }

  async getPatientStats(req, res) {
    try {
      const stats = await this.getPatientStatsUseCase.execute();
      return res.status(200).json({ success: true, stats });
    } catch (error) {
      console.error("[getPatientStats] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to fetch patient statistics.",
      });
    }
  }

  async getPatientById(req, res) {
    try {
      const { id } = req.params;
      if (!this.userRepository) {
        return res.status(501).json({
          success: false,
          message: "User repository not injected for patient detail lookup.",
        });
      }
      const patient = await this.userRepository.getAdminPatientById(id);
      if (!patient) {
        return res.status(404).json({ success: false, message: "Patient not found" });
      }
      return res.status(200).json({ success: true, patient, user: patient });
    } catch (error) {
      console.error("[getPatientById] Error:", error.message);
      const status = error.statusCode || (error.message.includes("not found") ? 404 : 500);
      return res.status(status).json({
        success: false,
        message: error.message || "Failed to fetch patient details.",
      });
    }
  }
}
