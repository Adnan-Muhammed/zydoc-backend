export class DebitWalletUseCase {
  constructor(walletRepository) {
    this.walletRepository = walletRepository;
  }

  async execute({ patientId, amount, description, appointmentId = null }) {
    if (!patientId) {
      throw new Error('patientId is required to debit wallet');
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Amount must be a positive number');
    }

    // Check balance first
    const currentBalance = await this.walletRepository.getBalance(patientId);
    if (currentBalance < numAmount) {
      const err = new Error(`Insufficient wallet balance. Available: ₹${currentBalance}, Requested: ₹${numAmount}`);
      err.code = 'INSUFFICIENT_WALLET_BALANCE';
      throw err;
    }

    return await this.walletRepository.debitWallet(
      patientId,
      numAmount,
      description || 'Appointment booking payment',
      appointmentId
    );
  }
}
