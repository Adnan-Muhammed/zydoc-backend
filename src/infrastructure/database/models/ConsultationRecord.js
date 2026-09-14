import mongoose from "mongoose";

const prescriptionItemSchema = new mongoose.Schema({
  id: { type: String },
  medicine: { type: String, required: true },
  dosage: { type: String, default: "" },
  frequency: { type: String, default: "" },
  duration: { type: String, default: "" },
  instructions: { type: String, default: "" },
  prescribedBy: { type: String, default: "" },
  date: { type: String, default: "" },
});

const consultationFileSchema = new mongoose.Schema({
  id: { type: String },
  name: { type: String, required: true },
  size: { type: String, default: "" },
  type: { type: String, default: "" },
  category: { type: String, default: "" },
  uploadedBy: { type: String, default: "" },
  timestamp: { type: String, default: "" },
  url: { type: String, default: "" },
});

const consultationRecordSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      unique: true,
      index: true,
    },

    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },

    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedUser",
      required: true,
      index: true,
    },

    clinicalNotes: {
      type: String,
      trim: true,
      default: "",
    },

    prescriptions: [prescriptionItemSchema],

    consultationFiles: [consultationFileSchema],
  },
  {
    timestamps: true,
  }
);

// Performance indexes
consultationRecordSchema.index({ doctorId: 1, createdAt: -1 });
consultationRecordSchema.index({ patientId: 1, createdAt: -1 });

export default mongoose.model("ConsultationRecord", consultationRecordSchema);
