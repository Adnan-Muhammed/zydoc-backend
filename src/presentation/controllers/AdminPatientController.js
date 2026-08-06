// src/presentation/controllers/AdminPatientController.js

export class AdminPatientController {
  constructor(getPatientsUseCase, getPatientStatsUseCase) {
    this.getPatientsUseCase = getPatientsUseCase;
    this.getPatientStatsUseCase = getPatientStatsUseCase;
  }

  async getPatients(req, res) {
    try {
      const filters = {
        search: req.query.search,
        status: req.query.status,
        gender: req.query.gender,
      };
      const options = {
        page: req.query.page,
        limit: req.query.limit,
        sortBy: req.query.sort,
      };
      const result = await this.getPatientsUseCase.execute(filters, options);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getPatientStats(req, res) {
    try {
      const stats = await this.getPatientStatsUseCase.execute();
      res.json({ success: true, stats });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}
