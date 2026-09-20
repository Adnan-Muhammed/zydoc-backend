// src/infrastructure/database/models/RefundTicket.js
import mongoose from "mongoose";

/**
 * ── Refund Ticket ─────────────────────────────────────────────────────────────
 * Tracks OFFLINE consultation refund requests raised by patients.
 *
 * Lifecycle:
 *   1. Patient reports an issue → ticket created with status "PENDING"
 *   2. Admin reviews, optionally requests more info → status "UNDER_REVIEW"
 *   3. Admin approves → status "APPROVED", wallet credited, Razorpay payout triggered
 *   4. Admin rejects → status "REJECTED", rejection reason stored
 *
 * Online consultation refunds are AUTO-processed and do NOT create a RefundTicket.
 * Only OFFLINE disputes that require manual admin intervention create one.
 */
const refundTicketSchema = new mongoose.Schema(
  {
    // ── Linked Entities ───────────────────────────────────────────────────────
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      index: true,
    },

    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedUser",
      required: true,
      index: true,
    },

    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },

    // ── Patient's Report ──────────────────────────────────────────────────────
    issueCategory: {
      type: String,
      enum: [
        "DOCTOR_UNAVAILABLE",    // Doctor didn't show up at clinic
        "SERVICE_NOT_RENDERED",  // Consultation didn't happen
        "WRONG_APPOINTMENT",     // Booking error
        "OTHER",
      ],
      required: true,
    },

    issueDescription: {
      type: String,
      trim: true,
      required: true,
      maxlength: 1000,
    },

    // Optional: patient-uploaded proof (photo/screenshot)
    proofUrl: {
      type: String,
      trim: true,
      default: "",
    },

    // ── Ticket Lifecycle ──────────────────────────────────────────────────────
    status: {
      type: String,
      enum: [
        "PENDING",       // Awaiting admin review (shows in the approval queue)
        "UNDER_REVIEW",  // Admin is actively reviewing
        "APPROVED",      // Refund granted; wallet credited
        "REJECTED",      // Refund denied
      ],
      default: "PENDING",
      index: true,
    },

    // ── Admin Resolution ──────────────────────────────────────────────────────
    resolvedBy: {
      // Reference to the SharedUser (admin) who resolved the ticket
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedUser",
      default: null,
    },

    adminNote: {
      // Admin's internal resolution note (visible only to admins)
      type: String,
      trim: true,
      default: "",
    },

    rejectionReason: {
      // Required when status = "REJECTED"
      type: String,
      trim: true,
      default: "",
    },

    resolvedAt: {
      type: Date,
      default: null,
    },

    // ── Refund Financial Details (populated on APPROVED) ──────────────────────
    refundAmount: {
      type: Number,
      default: 0,
    },

    // Razorpay payout ID for the bank withdrawal (if patient requested bank transfer)
    razorpayPayoutId: {
      type: String,
      trim: true,
      default: "",
      sparse: true,
    },

    // True if the patient opted to receive refund as bank transfer
    // False = wallet credit only (default)
    requestedBankTransfer: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Compound indexes for the admin dashboard queries
refundTicketSchema.index({ status: 1, createdAt: -1 }); // Pending queue sorted by oldest first
refundTicketSchema.index({ patientId: 1, status: 1 });
refundTicketSchema.index({ doctorId: 1, status: 1 });

export default mongoose.model("RefundTicket", refundTicketSchema);
