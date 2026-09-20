// src/application/usecases/admin/GetRevenueChartUseCase.js

export class GetRevenueChartUseCase {
  /**
   * @param {import('../../domain/repositories/AnalyticsRepository.js').AnalyticsRepository} analyticsRepository
   */
  constructor(analyticsRepository) {
    this.analyticsRepository = analyticsRepository;
  }

  /**
   * Execute revenue time series aggregation
   * @param {Object} params - { timeframe, days, months, startDate, endDate }
   */
  async execute(params = {}) {
    const validTimeframes = ["daily", "weekly", "monthly"];
    let { timeframe = "daily", days, months, startDate, endDate } = params;

    if (timeframe && !validTimeframes.includes(timeframe.toLowerCase())) {
      timeframe = "daily";
    }

    return await this.analyticsRepository.getRevenueChartData({
      timeframe: timeframe.toLowerCase(),
      days: days ? Number(days) : undefined,
      months: months ? Number(months) : undefined,
      startDate,
      endDate,
    });
  }
}
