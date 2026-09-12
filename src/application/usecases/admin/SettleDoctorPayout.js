export class SettleDoctorPayout {
  constructor(transactionRepository) {
    this.transactionRepository = transactionRepository;
  }

  async execute(transactionId, adminId) {
    if (!transactionId) {
      throw new Error("Transaction ID is required");
    }
    if (!adminId) {
      throw new Error("Admin ID is required for settlement");
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

    const doctor = transaction.doctorId;
    if (!doctor || !doctor.bankDetails || !doctor.bankDetails.accountNumber || !doctor.bankDetails.ifscCode) {
      const error = new Error("Cannot settle payout: Doctor has incomplete bank details.");
      error.statusCode = 400;
      throw error;
    }

    const updatedTransaction = await this.transactionRepository.settleTransactionAtomic(
      transactionId,
      adminId
    );

    if (!updatedTransaction) {
      const error = new Error("Transaction already settled or modified concurrently.");
      error.statusCode = 409;
      throw error;
    }

    return updatedTransaction;
  }
}
