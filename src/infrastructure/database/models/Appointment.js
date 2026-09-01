import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedUser",
      required: true,
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
      enum: ["video", "physical", "online", "offline"],
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
        "scheduled",
        "completed",
        "no-show",
        "cancelled",
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
      enum: ["pending", "paid", "refunded"],
      default: "pending",
    },

    notes: {
      type: String,
      trim: true,
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


    // last allowed time to join the consultation
    lateJoinCutoffAt: {
      type: Date,   // its  depends on        patientType follow up 
    },


    //     Final timing structure
    //   for eg: if the scheduledStartAt = 10:00 AM appointment :

    // scheduledStartAt  → 10:00 AM
    // scheduledEndAt    → 10:40 AM

    // Join status:

    // Before 9:57  consider    → EARLY   
    // 9:57 - 10:05   consider  → ON_TIME
    // After 10:05    consider  → LATE

    // Late entry cutoff:

    // NEW       → 10:15 AM
    // FOLLOW_UP → 10:25 AM



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

export default mongoose.model("Appointment", appointmentSchema);