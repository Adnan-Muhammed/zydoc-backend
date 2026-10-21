import mongoose from "mongoose";

// Minimal payment metadata retained after an expired appointment lock is deleted.
const expiredSlotLockSchema = new mongoose.Schema({
  appointmentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  razorpayOrderId: { type: String, required: true, unique: true },
  fee: { type: Number, required: true },
  feeBreakdown: {
    totalFee: { type: Number, default: 0 },
    walletDeducted: { type: Number, default: 0 },
    onlinePaid: { type: Number, default: 0 },
  },
}, { timestamps: true });

export default mongoose.model("ExpiredSlotLock", expiredSlotLockSchema);
