// src/infrastructure/database/models/DoctorSlotOverride.js
import mongoose from "mongoose";

const doctorSlotOverrideSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },
    date: {
      type: String, // "YYYY-MM-DD"
      required: true,
      index: true,
    },
    time: {
      type: String, // e.g., "02:30 PM"
      required: true,
    },
    status: {
      type: String,
      enum: ["unavailable", "break", "closed"],
      default: "unavailable",
    },
    reason: {
      type: String,
      default: "Doctor on break",
      trim: true,
    },
  },
  { timestamps: true }
);

// Compound unique index ensuring only 1 override per doctor, date, and slot time
doctorSlotOverrideSchema.index(
  { doctorId: 1, date: 1, time: 1 },
  { unique: true }
);

export default mongoose.model("DoctorSlotOverride", doctorSlotOverrideSchema);
