// src/domain/repositories/AnalyticsRepository.js

export class AnalyticsRepository {
  /**
   * Retrieves high-level KPI stats:
   * - Total active doctors
   * - Total registered patients
   * - Total platform revenue (admin commission)
   * - Today's appointment counts
   */
  async getSummaryStats() {
    throw new Error('Method not implemented');
  }

  /**
   * Aggregates completed/paid appointments into a time-series chart
   * @param {Object} params - { timeframe: 'daily' | 'weekly' | 'monthly', days?: number, months?: number }
   */
  async getRevenueChartData(params) {
    throw new Error('Method not implemented');
  }

  /**
   * Returns top doctors ranked by completed consultations and total earnings
   * @param {Object} options - { limit?: number }
   */
  async getTopDoctors(options) {
    throw new Error('Method not implemented');
  }

  /**
   * Returns comprehensive clinical intelligence aggregations for Healthcare Analytics
   * @param {Object} params - { range: '7d' | '30d' | '90d' | '1y' }
   */
  async getClinicalAnalyticsData(params) {
    throw new Error('Method not implemented');
  }
}
