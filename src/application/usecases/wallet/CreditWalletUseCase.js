export class CreditWalletUseCase {
  constructor(walletRepository, createNotificationUseCase = null) {
    this.walletRepository = walletRepository;
    this.createNotificationUseCase = createNotificationUseCase;
  }

  async execute({ patientId, amount, source, description, appointmentId = null }) {
    if (!patientId) {
      throw new Error('patientId is required to credit wallet');
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Amount must be a positive number');
    }
    if (!source) {
      throw new Error('source is required for wallet credit');
    }
    if (!description) {
      throw new Error('description is required for wallet credit');
    }

    const result = await this.walletRepository.creditWallet(
      patientId,
      numAmount,
      source,
      description,
      appointmentId
    );

    // Emit notification to patient if notification usecase is available
    if (this.createNotificationUseCase && typeof this.createNotificationUseCase.execute === 'function') {
      try {
        await this.createNotificationUseCase.execute({
          recipientId: patientId,
          recipientModel: 'User',
          type: 'WALLET_CREDITED',
          title: 'Wallet Credited',
          message: `₹${numAmount} has been credited to your wallet. ${description}`,
          referenceId: appointmentId || undefined,
        });
      } catch (notifErr) {
        console.error('[CreditWalletUseCase] Failed to send credit notification:', notifErr);
      }
    }

    return result;
  }
}
