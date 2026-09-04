export class TransactionRepository {
    async create(transactionData) { throw new Error('Method not implemented'); }
    async createTransaction(transactionData) { throw new Error('Method not implemented'); }
    async findById(id) { throw new Error('Method not implemented'); }
    async findByPaymentId(paymentId) { throw new Error('Method not implemented'); }
    async findByAppointmentId(appointmentId) { throw new Error('Method not implemented'); }
    async updateStatus(id, status) { throw new Error('Method not implemented'); }
    async updateTransactionStatus(transactionId, status) { throw new Error('Method not implemented'); }
    async updateStatusByAppointmentId(appointmentId, status) { throw new Error('Method not implemented'); }
    async findAllTransactionsAdmin(page, limit) { throw new Error('Method not implemented'); }
    async findAllAdmin(page, limit) { throw new Error('Method not implemented'); }
    async findTransactionsByDoctorId(doctorId, page, limit) { throw new Error('Method not implemented'); }
    async findByDoctorId(doctorId, page, limit) { throw new Error('Method not implemented'); }
    async calculateDoctorEarnings(doctorId) { throw new Error('Method not implemented'); }
}
