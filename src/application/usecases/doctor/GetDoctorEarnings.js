export class GetDoctorEarnings {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  async execute(doctorId, { page = 1, limit = 10 } = {}) {
    if (!doctorId) {
      throw new Error("Doctor ID is required");
    }

    const [earningsSummary, transactionsData] = await Promise.all([
      this.transactionRepository.calculateDoctorEarnings(doctorId),
      this.transactionRepository.findTransactionsByDoctorId(doctorId, page, limit)
    ]);

    return {
      summary: earningsSummary,
      transactions: transactionsData.transactions,
      pagination: {
        total: transactionsData.total,
        page: transactionsData.page,
        limit: transactionsData.limit,
        totalPages: transactionsData.totalPages
      }
    };
  }
}
