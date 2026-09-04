export class GetAllTransactions {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  async execute({ page = 1, limit = 10 } = {}) {
    return await this.transactionRepository.findAllTransactionsAdmin(page, limit);
  }
}
