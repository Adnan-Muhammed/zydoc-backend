// src/infrastructure/database/models/SharedUser.js
import mongoose from "mongoose";

const sharedUserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["admin", "doctor", "patient", "unassigned"],
      required: true,
    },
    // This dynamically links to Admin, Doctor, or Patient collections
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      required: function() { return this.role !== 'unassigned'; },
      refPath: "roleModel",
    },
    roleModel: {
      type: String,
      required: function() { return this.role !== 'unassigned'; },
      enum: ["Admin", "Doctor", "Patient"],
    },
    otp: {
      code: { type: String },
      expiresAt: { type: Date },
    },
    isVerified: { type: Boolean, default: false }, // Useful for Signup OTP flow
    googleName: { type: String },
    googleAvatarUrl: { type: String },

    // profile-update update new lines of code here
    // 🔥 THE GATEKEEPER: Keeps layout guard checks lightning fast
    // 🔥 Keeps dashboard access locked until onboarding form is finalized
    isProfileCompleted: {
      type: Boolean,
      default: false,
    },
    // profile-update update new lines of code here

    accountStatus: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
    },

    refreshToken: { type: String, select: false },
  },
  { timestamps: true },
);

export default mongoose.model("SharedUser", sharedUserSchema);
