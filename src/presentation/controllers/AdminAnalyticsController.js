// src/presentation/controllers/AdminAnalyticsController.js

export class AdminAnalyticsController {
  /**
   * @param {import('../../application/usecases/admin/GetAnalyticsSummaryUseCase.js').GetAnalyticsSummaryUseCase} getAnalyticsSummaryUseCase
   * @param {import('../../application/usecases/admin/GetRevenueChartUseCase.js').GetRevenueChartUseCase} getRevenueChartUseCase
   * @param {import('../../application/usecases/admin/GetTopDoctorsUseCase.js').GetTopDoctorsUseCase} getTopDoctorsUseCase
   * @param {import('../../application/usecases/admin/GetClinicalAnalyticsUseCase.js').GetClinicalAnalyticsUseCase} [getClinicalAnalyticsUseCase]
   */
  constructor(
    getAnalyticsSummaryUseCase,
    getRevenueChartUseCase,
    getTopDoctorsUseCase,
    getClinicalAnalyticsUseCase
  ) {
    this.getAnalyticsSummaryUseCase = getAnalyticsSummaryUseCase;
    this.getRevenueChartUseCase = getRevenueChartUseCase;
    this.getTopDoctorsUseCase = getTopDoctorsUseCase;
    this.getClinicalAnalyticsUseCase = getClinicalAnalyticsUseCase;
  }

  // ── GET /api/admin/analytics/summary ───────────────────────────────────────
  async getSummary(req, res) {
    try {
      const summary = await this.getAnalyticsSummaryUseCase.execute();
      return res.status(200).json({
        success: true,
        summary,
      });
    } catch (error) {
      console.error("[getSummary] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to fetch dashboard summary statistics.",
      });
    }
  }

  // ── GET /api/admin/analytics/revenue-chart ─────────────────────────────────
  async getRevenueChart(req, res) {
    try {
      const { timeframe, days, months, startDate, endDate } = req.query;
      const chart = await this.getRevenueChartUseCase.execute({
        timeframe,
        days,
        months,
        startDate,
        endDate,
      });

      return res.status(200).json({
        success: true,
        ...chart,
      });
    } catch (error) {
      console.error("[getRevenueChart] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to fetch revenue aggregation chart data.",
      });
    }
  }

  // ── GET /api/admin/analytics/top-doctors ───────────────────────────────────
  async getTopDoctors(req, res) {
    try {
      const { limit = 5 } = req.query;
      const topDoctors = await this.getTopDoctorsUseCase.execute({ limit });

      return res.status(200).json({
        success: true,
        total: topDoctors.length,
        topDoctors,
      });
    } catch (error) {
      console.error("[getTopDoctors] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to fetch top performing doctors.",
      });
    }
  }

  // ── GET /api/admin/analytics/clinical ──────────────────────────────────────
  async getClinicalAnalytics(req, res) {
    try {
      const { range = "30d" } = req.query;
      const clinicalData = await this.getClinicalAnalyticsUseCase.execute({ range });

      return res.status(200).json({
        success: true,
        ...clinicalData,
      });
    } catch (error) {
      console.error("[getClinicalAnalytics] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to fetch clinical analytics aggregations.",
      });
    }
  }
}
