export class SettleDoctorPayout {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  async execute(transactionId) {
    if (!transactionId) {
      throw new Error("Transaction ID is required");
    }

    const transaction = await this.transactionRepository.findById(transactionId);
    if (!transaction) {
      throw new Error("Transaction not found");
    }

    if (transaction.status === 'settled') {
      throw new Error("Transaction is already settled");
    }

    if (transaction.status !== 'completed') {
      throw new Error(`Cannot settle transaction with status '${transaction.status}'. Consultation must be completed first.`);
    }

    const updatedTransaction = await this.transactionRepository.updateTransactionStatus(
      transactionId,
      'settled'
    );

    return updatedTransaction;
  }
}
