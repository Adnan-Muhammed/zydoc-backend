// // src/infrastructure/database/models/DoctorProfile.js

// import mongoose from "mongoose";

// const doctorSchema = new mongoose.Schema({
//     name: { type: String, required: true },
//     specialization: { type: String },
//     licenseNumber: { type: String },
//     availability: [String],
// }, { timestamps: true });

// export default mongoose.model("Doctor", doctorSchema);

// src/infrastructure/database/models/DoctorProfile.js
import mongoose from "mongoose";

// Sub-document for clean qualification layout indexing
const qualificationSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    degree: { type: String, required: true },
    institution: { type: String, required: true },
    year: { type: Number, required: true },
  },
  { _id: false },
);

// Sub-document for shift operations window
const shiftTimeSchema = new mongoose.Schema(
  {
    start: { type: String, default: "09:00" }, // 24hr string formats matching browser inputs
    end: { type: String, default: "17:00" },
    active: { type: Boolean, default: false },
  },
  { _id: false },
);

const doctorSchema = new mongoose.Schema(
  {
    // Core Display Values
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
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

    // Media Attachments and Document File Paths (URLs pointing to secure uploads bucket)
    avatarUrl: { type: String, default: "" },
    medicalCertificateUrl: { type: String, default: "" },
    governmentIdUrl: { type: String, default: "" },

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

    // Granular Channel Consultation Parameter maps
    consultationSettings: {
      video: {
        enabled: { type: Boolean, default: true },
        fee: { type: Number, default: 0 },
      },
      physical: {
        enabled: { type: Boolean, default: false },
        fee: { type: Number, default: 0 },
        clinicName: { type: String, trim: true },
        clinicAddress: { type: String, trim: true },
      },
    },

    // Weekly Operations Time Shift block configuration layout
    workingHours: {
      mondayToFriday: {
        type: shiftTimeSchema,
        default: () => ({ active: true, start: "09:00", end: "17:00" }),
      },
      saturday: {
        type: shiftTimeSchema,
        default: () => ({ active: true, start: "10:00", end: "14:00" }),
      },
      sunday: {
        type: shiftTimeSchema,
        default: () => ({ active: false, start: "00:00", end: "00:00" }),
      },
    },

    // Aggregated reviews summary calculations cache
    rating: { type: Number, default: 5.0 },
    reviewCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Performance indexes
doctorSchema.index({ verificationStatus: 1 });
doctorSchema.index({ specialty: 1 });
doctorSchema.index({ rating: -1 });

export default mongoose.model("Doctor", doctorSchema);
