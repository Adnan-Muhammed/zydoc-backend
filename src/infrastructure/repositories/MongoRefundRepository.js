// src/infrastructure/repositories/MongoRefundRepository.js

import mongoose from "mongoose";
import { RefundRepository } from "../../domain/repositories/RefundRepository.js";
import RefundTicket from "../database/models/RefundTicket.js";
import SharedUser from "../database/models/SharedUser.js";
import Patient from "../database/models/PatientProfile.js";
import Doctor from "../database/models/DoctorProfile.js";
import Appointment from "../database/models/Appointment.js";
import WalletTransaction from "../database/models/WalletTransaction.js";
import Transaction from "../database/models/Transaction.js";
import Admin from "../database/models/AdminProfile.js";

/**
 * ── Mongo Refund Repository ───────────────────────────────────────────────────
 * Concrete implementation of RefundRepository backed by MongoDB/Mongoose.
 * Implements strict ACID database transactions for refund approvals.
 */
export class MongoRefundRepository extends RefundRepository {
  /**
   * Fetches unresolved/pending offline refund tickets.
   * Populates full patient, doctor, and appointment details so admins
   * have all necessary context to make informed approval/rejection decisions.
   *
   * @param {object} params
   * @param {number} [params.page=1]
   * @param {number} [params.limit=20]
   * @param {string} [params.status="PENDING"] - "PENDING", "UNDER_REVIEW", or "ALL"
   * @returns {Promise<{ tickets: object[], total: number, page: number, limit: number, totalPages: number }>}
   */
  async getPendingTickets({ page = 1, limit = 20, status = "PENDING" } = {}) {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Filter criteria
    let filter = {};
    if (status && status === "ALL") {
      filter.status = { $in: ["PENDING", "UNDER_REVIEW"] };
    } else if (status) {
      filter.status = status;
    } else {
      filter.status = "PENDING";
    }

    const [tickets, total] = await Promise.all([
      RefundTicket.find(filter)
        .sort({ createdAt: 1 }) // FIFO: oldest pending tickets first
        .skip(skip)
        .limit(limitNum)
        .populate({
          path: "patientId",
          model: "SharedUser",
          select: "email role profileId isProfileCompleted accountStatus",
          populate: {
            path: "profileId",
            model: "Patient",
            select:
              "firstName lastName phone avatarUrl walletBalance bloodGroup emergencyContact",
          },
        })
        .populate({
          path: "doctorId",
          model: "Doctor",
          select:
            "firstName lastName specialty phone avatarUrl clinicAddress consultationFee",
        })
        .populate({
          path: "appointmentId",
          model: "Appointment",
          select:
            "appointmentDate appointmentTime consultationType patientType status paymentStatus fee feeBreakdown paymentMethod offlineOTP offlineOTPVerifiedAt scheduledStartAt scheduledEndAt",
        })
        .populate({
          path: "resolvedBy",
          model: "SharedUser",
          select: "email role",
        })
        .lean(),
      RefundTicket.countDocuments(filter),
    ]);

    return {
      tickets,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1,
    };
  }

  /**
   * Fetches a single refund ticket by ID with populated details.
   *
   * @param {string} id
   * @returns {Promise<object>}
   */
  async getTicketById(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      const error = new Error("Invalid ticket ID format.");
      error.statusCode = 400;
      throw error;
    }

    const ticket = await RefundTicket.findById(id)
      .populate({
        path: "patientId",
        model: "SharedUser",
        select: "email role profileId isProfileCompleted accountStatus",
        populate: {
          path: "profileId",
          model: "Patient",
          select:
            "firstName lastName phone avatarUrl walletBalance bloodGroup emergencyContact",
        },
      })
      .populate({
        path: "doctorId",
        model: "Doctor",
        select:
          "firstName lastName specialty phone avatarUrl clinicAddress consultationFee",
      })
      .populate({
        path: "appointmentId",
        model: "Appointment",
        select:
          "appointmentDate appointmentTime consultationType patientType status paymentStatus fee feeBreakdown paymentMethod offlineOTP offlineOTPVerifiedAt scheduledStartAt scheduledEndAt",
      })
      .populate({
        path: "resolvedBy",
        model: "SharedUser",
        select: "email role",
      })
      .lean();

    if (!ticket) {
      const error = new Error("Refund ticket not found.");
      error.statusCode = 404;
      throw error;
    }

    return ticket;
  }

  /**
   * Approves a refund ticket.
   *
   * CRITICAL ARCHITECTURAL CONSTRAINT:
   * Uses a MongoDB Transaction (Session) so that updating the RefundTicket to
   * 'APPROVED' AND crediting the patient's wallet (WalletTransaction creation +
   * balance update on PatientProfile) execute atomically. If any part fails,
   * all writes are rolled back.
   *
   * @param {object} params
   * @param {string} params.ticketId
   * @param {string} params.adminUserId
   * @param {number} [params.refundAmount]
   * @param {string} [params.adminNote]
   * @returns {Promise<{ ticket: object, walletTransaction: object, refundAmount: number, patientNewBalance: number, patientUserId: string, patientEmail: string }>}
   */
  async approveTicket({ ticketId, adminUserId, refundAmount, adminNote = "" }) {
    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      const error = new Error("Invalid ticket ID format.");
      error.statusCode = 400;
      throw error;
    }

    const session = await mongoose.startSession();
    let result;

    const executeTransaction = async (activeSession) => {
      // 1. Fetch ticket inside session
      const ticketQuery = RefundTicket.findById(ticketId);
      if (activeSession) ticketQuery.session(activeSession);
      const ticket = await ticketQuery;

      if (!ticket) {
        const error = new Error("Refund ticket not found.");
        error.statusCode = 404;
        throw error;
      }

      if (ticket.status === "APPROVED") {
        const error = new Error(
          "Refund ticket has already been approved previously."
        );
        error.statusCode = 400;
        throw error;
      }

      if (ticket.status === "REJECTED") {
        const error = new Error(
          "Cannot approve a refund ticket that has already been rejected."
        );
        error.statusCode = 400;
        throw error;
      }

      // 2. Fetch linked appointment to derive amount and cross-verify
      let appointment = null;
      if (ticket.appointmentId) {
        const appQuery = Appointment.findById(ticket.appointmentId);
        if (activeSession) appQuery.session(activeSession);
        appointment = await appQuery;
      }

      // 3. Determine final refund amount
      let finalRefundAmount = refundAmount;
      if (
        finalRefundAmount === undefined ||
        finalRefundAmount === null ||
        Number(finalRefundAmount) <= 0
      ) {
        finalRefundAmount = Number(
          appointment?.feeBreakdown?.totalFee ||
            appointment?.fee ||
            ticket.refundAmount ||
            0
        );
      } else {
        finalRefundAmount = Number(finalRefundAmount);
      }

      if (isNaN(finalRefundAmount) || finalRefundAmount <= 0) {
        const error = new Error(
          "Invalid refund amount. Must be greater than 0."
        );
        error.statusCode = 400;
        throw error;
      }

      // 4. Resolve patient identifiers (SharedUser._id and PatientProfile._id)
      const sharedUserQuery = SharedUser.findById(ticket.patientId);
      if (activeSession) sharedUserQuery.session(activeSession);
      const sharedUser = await sharedUserQuery;

      let patientProfileId = null;
      let sharedUserId = null;

      if (sharedUser) {
        sharedUserId = sharedUser._id;
        patientProfileId = sharedUser.profileId;
      } else {
        // Fallback: If ticket.patientId was directly a PatientProfile ID
        const patientQuery = Patient.findById(ticket.patientId);
        if (activeSession) patientQuery.session(activeSession);
        const patientProfile = await patientQuery;
        if (patientProfile) {
          patientProfileId = patientProfile._id;
          const linkedUser = await SharedUser.findOne({
            profileId: patientProfile._id,
          });
          sharedUserId = linkedUser ? linkedUser._id : ticket.patientId;
        }
      }

      if (!patientProfileId) {
        const error = new Error(
          "Patient profile not found. Cannot credit wallet balance."
        );
        error.statusCode = 404;
        throw error;
      }

      // 5. Update RefundTicket
      ticket.status = "APPROVED";
      ticket.resolvedBy = adminUserId;
      ticket.resolvedAt = new Date();
      ticket.refundAmount = finalRefundAmount;
      if (adminNote && adminNote.trim()) {
        ticket.adminNote = adminNote.trim();
      }
      await ticket.save(activeSession ? { session: activeSession } : {});

      // 6. Credit Patient Wallet Balance atomically
      const updateOpts = activeSession
        ? { session: activeSession, returnDocument: "after" }
        : { returnDocument: "after" };

      const updatedProfile = await Patient.findByIdAndUpdate(
        patientProfileId,
        { $inc: { walletBalance: finalRefundAmount } },
        updateOpts
      );

      if (!updatedProfile) {
        throw new Error("Failed to credit patient wallet balance.");
      }

      // 7. Create WalletTransaction audit record
      const walletTxPayload = {
        patientId: sharedUserId,
        amount: finalRefundAmount,
        type: "CREDIT",
        source: "OFFLINE_DISPUTE",
        description: adminNote?.trim()
          ? `Refund for offline consultation (Ticket #${ticket._id}): ${adminNote.trim()}`
          : `Refund for offline consultation dispute (Ticket #${ticket._id}) approved by Admin`,
        appointmentId: ticket.appointmentId,
        initiatedBy: adminUserId,
        createdAt: new Date(),
      };

      const createOpts = activeSession ? { session: activeSession } : {};
      const txDocs = await WalletTransaction.create([walletTxPayload], createOpts);
      const walletTransaction = txDocs[0] || txDocs;

      // 8. Update Appointment status
      if (appointment) {
        appointment.status = "refunded";
        appointment.paymentStatus = "refunded";
        appointment.disputeResolvedAt = new Date();
        appointment.refundedAt = new Date();
        appointment.refundAmount = finalRefundAmount;
        if (adminNote?.trim()) {
          appointment.adminRefundNotes = adminNote.trim();
        }
        await appointment.save(activeSession ? { session: activeSession } : {});
      }

      // 9. Cancel/Refund Doctor Payout in platform Transaction (if exists)
      if (ticket.appointmentId) {
        await Transaction.findOneAndUpdate(
          { appointmentId: ticket.appointmentId },
          { $set: { status: "refunded" } },
          activeSession ? { session: activeSession } : {}
        );
      }

      // 10. Append to Admin Activity Log
      if (adminUserId) {
        try {
          const adminUser = await SharedUser.findById(adminUserId);
          if (adminUser?.profileId) {
            await Admin.findByIdAndUpdate(
              adminUser.profileId,
              {
                $push: {
                  adminActivityLog: {
                    $each: [
                      {
                        action: "REFUND_APPROVED",
                        targetId: ticket._id,
                        targetModel: "RefundTicket",
                        note: `Approved refund of ₹${finalRefundAmount} for Ticket #${ticket._id}`,
                        performedAt: new Date(),
                      },
                    ],
                    $slice: -200, // Capped at 200 most recent actions
                  },
                },
              },
              activeSession ? { session: activeSession } : {}
            );
          }
        } catch (logErr) {
          console.error("[MongoRefundRepository] Error appending admin log:", logErr.message);
        }
      }

      return {
        ticket: ticket.toObject ? ticket.toObject() : ticket,
        walletTransaction,
        refundAmount: finalRefundAmount,
        patientNewBalance: Number(updatedProfile.walletBalance || 0),
        appointmentId: ticket.appointmentId,
        patientUserId: sharedUserId,
        patientEmail: sharedUser?.email || "",
      };
    };

    try {
      session.startTransaction();
      result = await executeTransaction(session);
      await session.commitTransaction();
    } catch (txError) {
      await session.abortTransaction();

      // Graceful fallback for local development if standalone mongod has no replica set
      if (
        txError.message &&
        (txError.message.includes("replica set") ||
          txError.message.includes("Transaction numbers are only allowed"))
      ) {
        console.warn(
          "[MongoRefundRepository] MongoDB replica set not active. Executing refund operations sequentially for standalone dev environment."
        );
        result = await executeTransaction(null);
      } else {
        throw txError;
      }
    } finally {
      session.endSession();
    }

    return result;
  }

  /**
   * Rejects an offline refund ticket with mandatory admin note/reason.
   *
   * @param {object} params
   * @param {string} params.ticketId
   * @param {string} params.adminUserId
   * @param {string} params.adminNote
   * @returns {Promise<object>} The updated RefundTicket
   */
  async rejectTicket({ ticketId, adminUserId, adminNote }) {
    if (!mongoose.Types.ObjectId.isValid(ticketId)) {
      const error = new Error("Invalid ticket ID format.");
      error.statusCode = 400;
      throw error;
    }

    const ticket = await RefundTicket.findById(ticketId);
    if (!ticket) {
      const error = new Error("Refund ticket not found.");
      error.statusCode = 404;
      throw error;
    }

    if (ticket.status === "REJECTED") {
      const error = new Error("Refund ticket has already been rejected.");
      error.statusCode = 400;
      throw error;
    }

    if (ticket.status === "APPROVED") {
      const error = new Error(
        "Cannot reject a refund ticket that has already been approved."
      );
      error.statusCode = 400;
      throw error;
    }

    const trimmedNote = adminNote.trim();

    ticket.status = "REJECTED";
    ticket.resolvedBy = adminUserId;
    ticket.resolvedAt = new Date();
    ticket.adminNote = trimmedNote;
    ticket.rejectionReason = trimmedNote; // Sync schema's rejectionReason field

    await ticket.save();

    // If appointment is linked, record dispute resolution timestamp
    if (ticket.appointmentId) {
      await Appointment.findByIdAndUpdate(ticket.appointmentId, {
        disputeResolvedAt: new Date(),
        adminRefundNotes: `Refund request rejected: ${trimmedNote}`,
      });
    }

    // Append to Admin Activity Log
    if (adminUserId) {
      try {
        const adminUser = await SharedUser.findById(adminUserId);
        if (adminUser?.profileId) {
          await Admin.findByIdAndUpdate(adminUser.profileId, {
            $push: {
              adminActivityLog: {
                $each: [
                  {
                    action: "REFUND_REJECTED",
                    targetId: ticket._id,
                    targetModel: "RefundTicket",
                    note: `Rejected refund for Ticket #${ticket._id}. Reason: ${trimmedNote}`,
                    performedAt: new Date(),
                  },
                ],
                $slice: -200,
              },
            },
          });
        }
      } catch (logErr) {
        console.error("[MongoRefundRepository] Error appending admin log:", logErr.message);
      }
    }

    return ticket.toObject ? ticket.toObject() : ticket;
  }
}
