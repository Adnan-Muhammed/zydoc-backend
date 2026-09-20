import mongoose from 'mongoose';
import { WalletRepository } from '../../domain/repositories/WalletRepository.js';
import SharedUser from '../database/models/SharedUser.js';
import Patient from '../database/models/PatientProfile.js';
import WalletTransaction from '../database/models/WalletTransaction.js';

export class MongoWalletRepository extends WalletRepository {
  /**
   * Helper to resolve both SharedUser._id and PatientProfile._id
   */
  async _resolvePatientIdentifiers(patientId) {
    if (!patientId) throw new Error('Patient ID is required');

    let sharedUserId = null;
    let patientProfileId = null;

    // Check if patientId is a SharedUser ID
    const sharedUser = await SharedUser.findById(patientId);
    if (sharedUser) {
      sharedUserId = sharedUser._id;
      patientProfileId = sharedUser.profileId;
    } else {
      // Check if patientId is directly the PatientProfile ID
      const patientProfile = await Patient.findById(patientId);
      if (patientProfile) {
        patientProfileId = patientProfile._id;
        const linkedUser = await SharedUser.findOne({ profileId: patientProfile._id });
        sharedUserId = linkedUser ? linkedUser._id : patientId;
      }
    }

    if (!patientProfileId) {
      throw new Error(`Patient profile not found for ID: ${patientId}`);
    }

    return { sharedUserId, patientProfileId };
  }

  async getBalance(patientId) {
    try {
      const { patientProfileId } = await this._resolvePatientIdentifiers(patientId);
      const patient = await Patient.findById(patientProfileId).select('walletBalance');
      return Number(patient?.walletBalance || 0);
    } catch (error) {
      console.error('[MongoWalletRepository.getBalance] Error:', error);
      throw error;
    }
  }

  async creditWallet(patientId, amount, source, description, appointmentId = null, session = null) {
    try {
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('Invalid credit amount');
      }

      const { sharedUserId, patientProfileId } = await this._resolvePatientIdentifiers(patientId);

      const updateOpts = session ? { session, returnDocument: 'after' } : { returnDocument: 'after' };

      const updatedProfile = await Patient.findByIdAndUpdate(
        patientProfileId,
        { $inc: { walletBalance: numAmount } },
        updateOpts
      );

      if (!updatedProfile) {
        throw new Error('Failed to update patient wallet balance');
      }

      const txPayload = {
        patientId: sharedUserId,
        amount: numAmount,
        type: 'CREDIT',
        source,
        description,
        appointmentId: appointmentId || null,
        createdAt: new Date(),
      };

      const txDocs = await WalletTransaction.create([txPayload], session ? { session } : {});
      const createdTx = txDocs[0] || txDocs;

      return {
        balance: Number(updatedProfile.walletBalance || 0),
        transaction: createdTx,
      };
    } catch (error) {
      console.error('[MongoWalletRepository.creditWallet] Error:', error);
      throw error;
    }
  }

  async debitWallet(patientId, amount, description, appointmentId = null, session = null) {
    try {
      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        throw new Error('Invalid debit amount');
      }

      const { sharedUserId, patientProfileId } = await this._resolvePatientIdentifiers(patientId);

      const updateOpts = session ? { session, returnDocument: 'after' } : { returnDocument: 'after' };

      // Atomic debit ensuring balance remains >= 0
      const updatedProfile = await Patient.findOneAndUpdate(
        { _id: patientProfileId, walletBalance: { $gte: numAmount } },
        { $inc: { walletBalance: -numAmount } },
        updateOpts
      );

      if (!updatedProfile) {
        throw new Error('Insufficient wallet balance');
      }

      const txPayload = {
        patientId: sharedUserId,
        amount: numAmount,
        type: 'DEBIT',
        source: 'BOOKING_PAYMENT',
        description,
        appointmentId: appointmentId || null,
        createdAt: new Date(),
      };

      const txDocs = await WalletTransaction.create([txPayload], session ? { session } : {});
      const createdTx = txDocs[0] || txDocs;

      return {
        balance: Number(updatedProfile.walletBalance || 0),
        transaction: createdTx,
      };
    } catch (error) {
      console.error('[MongoWalletRepository.debitWallet] Error:', error);
      throw error;
    }
  }

  async getTransactionHistory(patientId, { page = 1, limit = 10 } = {}) {
    try {
      const { sharedUserId } = await this._resolvePatientIdentifiers(patientId);

      const parsedPage = Math.max(1, parseInt(page, 10) || 1);
      const parsedLimit = Math.max(1, parseInt(limit, 10) || 10);
      const skip = (parsedPage - 1) * parsedLimit;

      const [transactions, total] = await Promise.all([
        WalletTransaction.find({ patientId: sharedUserId })
          .populate('appointmentId', 'appointmentDate appointmentTime consultationType status')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parsedLimit)
          .lean(),
        WalletTransaction.countDocuments({ patientId: sharedUserId }),
      ]);

      return {
        transactions,
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit) || 1,
      };
    } catch (error) {
      console.error('[MongoWalletRepository.getTransactionHistory] Error:', error);
      throw error;
    }
  }
}
