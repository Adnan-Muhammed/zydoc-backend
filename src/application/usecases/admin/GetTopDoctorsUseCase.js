// src/application/usecases/admin/GetTopDoctorsUseCase.js

export class GetTopDoctorsUseCase {
  /**
   * @param {import('../../domain/repositories/AnalyticsRepository.js').AnalyticsRepository} analyticsRepository
   */
  constructor(analyticsRepository) {
    this.analyticsRepository = analyticsRepository;
  }

  /**
   * Execute top doctors ranking aggregation
   * @param {Object} options - { limit?: number }
   */
  async execute(options = {}) {
    const limit = options.limit ? Math.max(1, Math.min(Number(options.limit), 50)) : 5;
    return await this.analyticsRepository.getTopDoctors({ limit });
  }
}
