export class WalletRepository {
  async getBalance(patientId) {
    throw new Error('Method not implemented');
  }

  async creditWallet(patientId, amount, source, description, appointmentId = null, session = null) {
    throw new Error('Method not implemented');
  }

  async debitWallet(patientId, amount, description, appointmentId = null, session = null) {
    throw new Error('Method not implemented');
  }

  async getTransactionHistory(patientId, { page = 1, limit = 10 } = {}) {
    throw new Error('Method not implemented');
  }
}
