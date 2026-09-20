export class GetPatientWalletUseCase {
  constructor(walletRepository) {
    this.walletRepository = walletRepository;
  }

  async execute(patientId, { page = 1, limit = 10 } = {}) {
    if (!patientId) {
      throw new Error('patientId is required');
    }

    const [balance, history] = await Promise.all([
      this.walletRepository.getBalance(patientId),
      this.walletRepository.getTransactionHistory(patientId, { page, limit }),
    ]);

    return {
      balance,
      transactions: history.transactions || [],
      total: history.total || 0,
      page: history.page || 1,
      limit: history.limit || 10,
      totalPages: history.totalPages || 1,
    };
  }
}
