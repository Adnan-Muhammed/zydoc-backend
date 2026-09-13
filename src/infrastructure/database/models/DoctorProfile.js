
// src/infrastructure/database/models/DoctorProfile.js 
import mongoose from "mongoose";

// Sub-document for clean qualification layout indexing
const qualificationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    degree: { type: String, required: true },
    institution: { type: String, required: true },
    year: { type: Number, required: true },
    certificateName: { type: String, default: "" },
    certificateUrl: { type: String, default: "" },
    certificateStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: { type: String, default: "" },
  },
  { _id: false },
);

// Sub-document for individual shift/session time blocks
const timeBlockSchema = new mongoose.Schema(
  {
    start: { type: String, required: true }, // 24hr format "HH:mm" (e.g. "09:00")
    end: { type: String, required: true },   // 24hr format "HH:mm" (e.g. "13:00")
  },
  { _id: false },
);

const doctorSchema = new mongoose.Schema(
  {
    // Core Display Values
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true, default: "" },
    phone: { 
      type: String, 
      trim: true,
      index: { unique: true, partialFilterExpression: { phone: { $type: "string" } } }
    },
    specialty: {
      type: String,
      default: "General Practice",
    },
    licenseNumber: { 
      type: String, 
      index: { unique: true, partialFilterExpression: { licenseNumber: { $type: "string" } } }
    }, // Partial index allows empty null states during signup
    yearsOfExperience: { type: Number, min: 0 },
    bio: { type: String, trim: true },

    // Consultation Slot Duration in minutes (e.g., 10, 15, 20, 30, 45, 60)
    slotDuration: {
      type: Number,
      required: true,
      default: 15,
    },

    // Doctor Operating / Clinic Timezone (e.g. 'Asia/Kolkata', 'America/New_York')
    timezone: {
      type: String,
      default: "Asia/Kolkata",
      trim: true,
    },

    // Media Attachments and Document File Paths (URLs pointing to secure uploads bucket)
    avatarUrl: { type: String, default: "" },
    medicalCertificateUrl: { type: String, default: "" },
    medicalCertificateStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    medicalCertificateRejectionReason: { type: String, default: "" },
    governmentIdUrl: { type: String, default: "" },
    governmentIdStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    governmentIdRejectionReason: { type: String, default: "" },

    // Compliance Check Processing Hook
    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    // Core Dynamic Text Metrics arrays
    expertiseTags: [{ type: String, trim: true }],
    languages: [{ type: String, default: ["English"] }],

    // Embedded Qualifications data matrix mapping
    qualifications: [qualificationSchema],

    // Standardized Channel Consultation Parameter maps (online / offline)
    consultationSettings: {
      online: {
        enabled: { type: Boolean, default: true },
        fee: { type: Number, default: 0 },
      },
      offline: {
        enabled: { type: Boolean, default: false },
        fee: { type: Number, default: 0 },
        clinicName: { type: String, trim: true },
        clinicAddress: { type: String, trim: true },
      },
    },

    // Weekly Operations Time Shift block configuration layout (Array of multiple sessions/breaks per day)
    workingHours: {
      online: {
        monday: { type: [timeBlockSchema], default: [] },
        tuesday: { type: [timeBlockSchema], default: [] },
        wednesday: { type: [timeBlockSchema], default: [] },
        thursday: { type: [timeBlockSchema], default: [] },
        friday: { type: [timeBlockSchema], default: [] },
        saturday: { type: [timeBlockSchema], default: [] },
        sunday: { type: [timeBlockSchema], default: [] },
      },
      offline: {
        monday: { type: [timeBlockSchema], default: [] },
        tuesday: { type: [timeBlockSchema], default: [] },
        wednesday: { type: [timeBlockSchema], default: [] },
        thursday: { type: [timeBlockSchema], default: [] },
        friday: { type: [timeBlockSchema], default: [] },
        saturday: { type: [timeBlockSchema], default: [] },
        sunday: { type: [timeBlockSchema], default: [] },
      }
    },

    // Aggregated reviews summary calculations cache
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },
    fcmToken: { type: String },

    // Bank Details for payout settlements
    bankDetails: {
      accountNumber: { type: String, default: "" },
      ifscCode: { type: String, default: "" },
      bankName: { type: String, default: "" },
      accountHolderName: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

// Performance indexes
doctorSchema.index({ verificationStatus: 1 });
doctorSchema.index({ specialty: 1 });
doctorSchema.index({ rating: -1 });

export default mongoose.model("Doctor", doctorSchema);
