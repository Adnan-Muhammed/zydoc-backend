import mongoose from "mongoose";
import { TransactionRepository } from "../../domain/repositories/TransactionRepository.js";
import Transaction from "../database/models/Transaction.js";
import SharedUser from "../database/models/SharedUser.js";
import Doctor from "../database/models/DoctorProfile.js";

export class MongoTransactionRepository extends TransactionRepository {
    async createTransaction(transactionData) {
        const transaction = new Transaction(transactionData);
        return await transaction.save();
    }

    async create(transactionData) {
        return await this.createTransaction(transactionData);
    }

    async findById(id) {
        return await Transaction.findById(id)
            .populate('doctorId', 'firstName lastName specialty avatarUrl phone bankDetails')
            .populate({
                path: 'patientId',
                select: 'email googleName googleAvatarUrl profileId',
                populate: {
                    path: 'profileId',
                    select: 'firstName lastName phone avatarUrl'
                }
            })
            .populate('appointmentId');
    }

    async findByPaymentId(paymentId) {
        return await Transaction.findOne({ paymentId });
    }

    async findByAppointmentId(appointmentId) {
        return await Transaction.findOne({ appointmentId });
    }

    async updateTransactionStatus(transactionId, status) {
        return await Transaction.findByIdAndUpdate(
            transactionId,
            { status },
            { returnDocument: 'after' }
        );
    }

    async updateStatus(id, status) {
        return await this.updateTransactionStatus(id, status);
    }

    async updateStatusByAppointmentId(appointmentId, status) {
        return await Transaction.findOneAndUpdate(
            { appointmentId },
            { status },
            { returnDocument: 'after' }
        );
    }

    async findAllTransactionsAdmin(page = 1, limit = 10) {
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 10);
        const skip = (pageNum - 1) * limitNum;

        const [transactions, total] = await Promise.all([
            Transaction.find()
                .populate({
                    path: 'doctorId',
                    select: 'firstName lastName specialty avatarUrl phone bankDetails'
                })
                .populate({
                    path: 'patientId',
                    select: 'email googleName googleAvatarUrl profileId',
                    populate: {
                        path: 'profileId',
                        select: 'firstName lastName phone avatarUrl'
                    }
                })
                .populate('appointmentId', 'appointmentDate appointmentTime consultationType status')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Transaction.countDocuments()
        ]);

        return {
            transactions,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
        };
    }

    async findAllAdmin(page = 1, limit = 10) {
        return await this.findAllTransactionsAdmin(page, limit);
    }

    async findTransactionsByDoctorId(doctorId, page = 1, limit = 10) {
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.max(1, parseInt(limit, 10) || 10);
        const skip = (pageNum - 1) * limitNum;

        let doctorObjectId;
        try {
            doctorObjectId = new mongoose.Types.ObjectId(doctorId);
        } catch (e) {
            doctorObjectId = doctorId;
        }

        const sharedUser = await SharedUser.findById(doctorId);
        const doctorIdsToMatch = [doctorObjectId];
        if (sharedUser && sharedUser.profileId) {
            doctorIdsToMatch.push(new mongoose.Types.ObjectId(sharedUser.profileId));
        }

        const query = { doctorId: { $in: doctorIdsToMatch } };

        const [transactions, total] = await Promise.all([
            Transaction.find(query)
                .populate({
                    path: 'patientId',
                    select: 'email googleName googleAvatarUrl profileId',
                    populate: {
                        path: 'profileId',
                        select: 'firstName lastName phone avatarUrl'
                    }
                })
                .populate('appointmentId', 'appointmentDate appointmentTime consultationType status')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean(),
            Transaction.countDocuments(query)
        ]);

        return {
            transactions,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
        };
    }

    async findByDoctorId(doctorId, page = 1, limit = 10) {
        return await this.findTransactionsByDoctorId(doctorId, page, limit);
    }

    async calculateDoctorEarnings(doctorId) {
        let doctorObjectId;
        try {
            doctorObjectId = new mongoose.Types.ObjectId(doctorId);
        } catch (e) {
            doctorObjectId = doctorId;
        }

        const sharedUser = await SharedUser.findById(doctorId);
        const doctorIdsToMatch = [doctorObjectId];
        if (sharedUser && sharedUser.profileId) {
            doctorIdsToMatch.push(new mongoose.Types.ObjectId(sharedUser.profileId));
        }

        const result = await Transaction.aggregate([
            {
                $match: {
                    doctorId: { $in: doctorIdsToMatch },
                    status: { $in: ['completed', 'settled'] }
                }
            },
            {
                $group: {
                    _id: '$status',
                    totalAmount: { $sum: '$doctorAmount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        let pendingEarnings = 0;
        let settledEarnings = 0;
        let pendingCount = 0;
        let settledCount = 0;

        result.forEach(item => {
            if (item._id === 'completed') {
                pendingEarnings = item.totalAmount;
                pendingCount = item.count;
            } else if (item._id === 'settled') {
                settledEarnings = item.totalAmount;
                settledCount = item.count;
            }
        });

        return {
            pendingEarnings,
            settledEarnings,
            totalEarnings: pendingEarnings + settledEarnings,
            pendingCount,
            settledCount
        };
    }
}
