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
      enum: ["admin", "doctor", "patient"],
      required: true,
    },
    // This dynamically links to Admin, Doctor, or Patient collections
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "roleModel",
    },
    roleModel: {
      type: String,
      required: true,
      enum: ["Admin", "Doctor", "Patient"],
    },
    otp: {
      code: { type: String },
      expiresAt: { type: Date },
    },
    isVerified: { type: Boolean, default: false }, // Useful for Signup OTP flow

    // profile-update update new lines of code here
    // 🔥 THE GATEKEEPER: Keeps layout guard checks lightning fast
    // 🔥 Keeps dashboard access locked until onboarding form is finalized
    isProfileCompleted: {
      type: Boolean,
      default: false,
    },
    // profile-update update new lines of code here

    refreshToken: { type: String, select: false },
  },
  { timestamps: true },
);

export default mongoose.model("SharedUser", sharedUserSchema);
