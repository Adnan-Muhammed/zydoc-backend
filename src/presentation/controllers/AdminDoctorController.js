export class AdminDoctorController {
  constructor(getDoctorsUseCase, getDoctorStatsUseCase) {
    this.getDoctorsUseCase = getDoctorsUseCase;
    this.getDoctorStatsUseCase = getDoctorStatsUseCase;
  }

  async getDoctors(req, res) {
    try {
      const { search, status, specialty, sort, page, limit } = req.query;
      const filters = { search, status, specialty };
      const options = { sortBy: sort, page, limit };
      
      const result = await this.getDoctorsUseCase.execute(filters, options);

      res.status(200).json({
        success: true,
        doctors: result.doctors || result,
        total: result.total || (result.length ? result.length : 0),
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }

  async getDoctorStats(req, res) {
    try {
      const stats = await this.getDoctorStatsUseCase.execute();
      res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}
