import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedUser",
      required: function () {
        return !this.isManualBooking;
      },
    },

    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    appointmentDate: {
      type: Date,
      required: true,
    },

    appointmentTime: {
      type: String,
      required: true,
    },

    consultationType: {
      type: String,
      enum: ["online", "offline", "video", "physical"],
      default: "online",
      required: true,
    },

    patientType: {
      type: String,
      enum: ["NEW", "FOLLOW_UP"],
      required: true,
    },

    status: {
      type: String,
      enum: [
        "available",
        "locked",
        "expired",      // lock TTL passed before payment was verified
        "scheduled",
        "completed",
        "no-show",
        "cancelled",
        "cancelled-by-doctor",
        "disputed",
        "refund_pending",
        "refunded",
      ],
      default: "scheduled",
    },

    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedUser",
    },

    lockExpiryTime: {
      type: Date,
    },

    paymentId: {
      type: String,
    },

    razorpayOrderId: {
      type: String,
    },

    adminCommission: {
      type: Number,
    },

    doctorAmount: {
      type: Number,
    },

    fee: {
      type: Number,
      required: true,
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "refunded", "direct"],
      default: "pending",
    },

    notes: {
      type: String,
      trim: true,
    },

    // Doctor private consultation notes (RBAC: restricted to doctor clinical console)
    clinicalNotes: {
      type: String,
      trim: true,
      default: "",
    },

    // Structured prescriptions array saved upon call completion / finalization
    prescriptions: [
      {
        id: { type: String },
        medicine: { type: String, required: true },
        dosage: { type: String, default: "" },
        frequency: { type: String, default: "" },
        duration: { type: String, default: "" },
        instructions: { type: String, default: "" },
        prescribedBy: { type: String, default: "" },
        date: { type: String, default: "" },
      },
    ],

    // Uploaded consultation files organized per session
    consultationFiles: [
      {
        id: { type: String },
        name: { type: String, required: true },
        size: { type: String, default: "" },
        type: { type: String, default: "" },
        category: { type: String, default: "" },
        uploadedBy: { type: String, default: "" },
        timestamp: { type: String, default: "" },
        url: { type: String, default: "" },
      },
    ],

    // Manual Booking (Direct Walk-in / Call / WhatsApp by Doctor)
    isManualBooking: {
      type: Boolean,
      default: false,
      index: true,
    },

    bookingSource: {
      type: String,
      enum: ["platform", "manual"],
      default: "platform",
      index: true,
    },

    // True when the doctor created this appointment directly (walk-in / call)
    // Distinct from isManualBooking to allow querying just doctor-initiated records
    bookedByDoctor: {
      type: Boolean,
      default: false,
      index: true,
    },

    manualPatientDetails: {
      name: { type: String, trim: true },
      opNumber: { type: String, trim: true },
      phone: { type: String, trim: true },
      notes: { type: String, trim: true },
    },

    // Socket.IO / consultation room
    roomId: {
      type: String,
      unique: true,
      sparse: true,
    },

    // Scheduled slot
    scheduledStartAt: {
      type: Date,
    },

    scheduledEndAt: {
      type: Date,
    },

    doctorTimezone: {
      type: String,
      default: "Asia/Kolkata",
    },

    patientTimezone: {
      type: String,
      default: null,
    },

    // Individual join times
    doctorJoinedAt: {
      type: Date,
    },

    patientJoinedAt: {
      type: Date,
    },

    // Future complaint / admin verification
    doctorJoinStatus: {
      type: String,
      enum: ["EARLY", "ON_TIME", "LATE"],
    },

    patientJoinStatus: {
      type: String,
      enum: ["EARLY", "ON_TIME", "LATE"],
    },

    sessionStartStatus: {
      type: String,
      enum: ["EARLY", "ON_TIME", "LATE"],
    },


    // Dynamic late join cutoff based on slot duration
    lateJoinCutoffAt: {
      type: Date,
    },

    // In-progress booking indicators
    isInProgressBooking: {
      type: Boolean,
      default: false,
    },

    effectiveBookedDuration: {
      type: Number, // In minutes
    },

    // Time when both doctor and patient are connected
    participantsConnectedAt: {
      type: Date,
    },

    // Consultation timer
    sessionStartedAt: {
      type: Date,
    },

    sessionEndedAt: {
      type: Date,
    },

    // ── Offline consultation verification ─────────────────────────────────
    // 4-digit code generated at booking; patient shows it to the doctor in-person
    offlineOTP: {
      type: String,
      sparse: true,
    },

    // Timestamp of when the doctor verified the OTP (audit trail)
    offlineOTPVerifiedAt: {
      type: Date,
    },

    // Set to true when doctor takes >1 min to join the next online room
    // after their current offline appointment ends (performance metric)
    doctorDelayed: {
      type: Boolean,
      default: false,
    },

    // Cancellation, Dispute, and Refund tracking
    cancellationReason: {
      type: String,
      trim: true,
    },

    cancelledAt: {
      type: Date,
    },

    refundId: {
      type: String,
      sparse: true,
    },

    refundAmount: {
      type: Number,
    },

    refundedAt: {
      type: Date,
    },

    disputeReason: {
      type: String,
      trim: true,
    },

    disputedAt: {
      type: Date,
    },

    disputeResolvedAt: {
      type: Date,
    },

    disputeProofUrl: {
      type: String,
      trim: true,
    },

    noShowMarkedAt: {
      type: Date,
    },

    adminRefundNotes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Performance indexes
appointmentSchema.index({ patientId: 1 });
appointmentSchema.index({ doctorId: 1 });
appointmentSchema.index({ appointmentDate: 1 });
appointmentSchema.index({ status: 1 });
appointmentSchema.index({ consultationType: 1 });
appointmentSchema.index({ consultationType: 1, status: 1, appointmentDate: 1 }); // for offline no-show cron
appointmentSchema.index({ lockExpiryTime: 1 }, { sparse: true }); // for expired-lock cleanup queries

/**
 * ── Slot-Lock Race Condition Guard ──────────────────────────────────────────
 * Unique partial index: enforces that only ONE active record can exist for a
 * given (doctorId, appointmentDate, appointmentTime) combination at any time.
 *
 * - `partialFilterExpression` limits the guarantee to active statuses only.
 *   Cancelled / refunded records are excluded so historical data never
 *   blocks a future re-booking of the same slot.
 * - Combined with the atomic `findOneAndUpdate + upsert` in lockSlot(), this
 *   index acts as the true DB-level mutex: the second concurrent writer will
 *   receive an E11000 duplicate-key error instead of silently succeeding.
 * - In production, create this via the migration script to avoid index rebuild
 *   downtime:  src/infrastructure/database/migrations/add_slot_lock_unique_index.js
 */
appointmentSchema.index(
    { doctorId: 1, appointmentDate: 1, appointmentTime: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: { $in: ["locked", "scheduled", "completed"] },
        },
        name: "unique_active_slot_per_doctor",
    }
);

export default mongoose.model("Appointment", appointmentSchema);