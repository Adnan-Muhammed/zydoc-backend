// src/infrastructure/database/models/WalletTransaction.js
import mongoose from "mongoose";

const walletTransactionSchema = new mongoose.Schema(
  {
    // ── Core Fields ───────────────────────────────────────────────────────────
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedUser",
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    type: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
      index: true,
    },

    // What triggered this wallet movement
    source: {
      type: String,
      enum: [
        "DOCTOR_MISSED",          // Auto-refund: doctor didn't join video call
        "OFFLINE_DISPUTE",        // Admin-approved offline refund ticket
        "PATIENT_CANCELLATION",   // Patient cancelled within allowed window
        "BOOKING_PAYMENT",        // Debit: wallet used to pay for booking
        "MANUAL_REFUND",          // Admin manually issued a one-off refund
        "BANK_WITHDRAWAL",        // Debit: patient withdrew wallet balance to bank
      ],
      required: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    // The appointment this transaction is linked to (if applicable)
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },

    // ── Bank Withdrawal / Razorpay Payout Tracking ────────────────────────────
    // Populated when source = "BANK_WITHDRAWAL"
    razorpayPayoutId: {
      type: String,
      trim: true,
      default: null,
      sparse: true,
    },

    // Tracks the lifecycle of a Razorpay bank payout
    withdrawalStatus: {
      type: String,
      enum: ["PENDING", "PROCESSING", "SUCCESS", "FAILED", null],
      default: null,
    },

    // ── Admin / System Actor ──────────────────────────────────────────────────
    // Who initiated this transaction — a SharedUser (admin) or null if system-triggered
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedUser",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

walletTransactionSchema.index({ patientId: 1, createdAt: -1 });
walletTransactionSchema.index({ source: 1 });
walletTransactionSchema.index({ withdrawalStatus: 1 }, { sparse: true });

export default mongoose.model("WalletTransaction", walletTransactionSchema);
