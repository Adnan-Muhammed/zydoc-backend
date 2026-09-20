// src/application/usecases/admin/GetAnalyticsSummaryUseCase.js

export class GetAnalyticsSummaryUseCase {
  /**
   * @param {import('../../domain/repositories/AnalyticsRepository.js').AnalyticsRepository} analyticsRepository
   */
  constructor(analyticsRepository) {
    this.analyticsRepository = analyticsRepository;
  }

  /**
   * Execute summary KPI fetch
   */
  async execute() {
    return await this.analyticsRepository.getSummaryStats();
  }
}
