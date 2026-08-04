import { TransactionRepository } from "../../domain/repositories/TransactionRepository.js";
import Transaction from "../database/models/Transaction.js";

export class MongoTransactionRepository extends TransactionRepository {
    async create(transactionData) {
        const transaction = new Transaction(transactionData);
        return await transaction.save();
    }

    async findById(id) {
        return await Transaction.findById(id);
    }

    async findByPaymentId(paymentId) {
        return await Transaction.findOne({ paymentId });
    }

    async updateStatus(id, status) {
        return await Transaction.findByIdAndUpdate(
            id,
            { status },
            { new: true }
        );
    }
}
