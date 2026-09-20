// src/application/usecases/admin/GetClinicalAnalyticsUseCase.js

export class GetClinicalAnalyticsUseCase {
  /**
   * @param {import('../../domain/repositories/AnalyticsRepository.js').AnalyticsRepository} analyticsRepository
   */
  constructor(analyticsRepository) {
    this.analyticsRepository = analyticsRepository;
  }

  /**
   * Execute clinical intelligence analytics aggregation
   * @param {Object} params
   * @param {string} [params.range='30d'] - '7d' | '30d' | '90d' | '1y'
   */
  async execute({ range = "30d" } = {}) {
    return await this.analyticsRepository.getClinicalAnalyticsData({ range });
  }
}
