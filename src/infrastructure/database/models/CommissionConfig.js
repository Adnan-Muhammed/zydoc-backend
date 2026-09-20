// src/infrastructure/database/models/CommissionConfig.js
import mongoose from "mongoose";

/**
 * ── Commission Config ─────────────────────────────────────────────────────────
 * Stores the ACTIVE online and offline commission percentages.
 *
 * Design Decision (Singleton Pattern):
 * There is only ever ONE active CommissionConfig document in the collection.
 * On app startup / first admin setup, a seed script inserts the default document.
 * All admin "update commission" actions use findOneAndUpdate({ _id: theOnlyDoc._id }).
 *
 * The `changeHistory` array provides a full audit trail of every rate change,
 * who made it, and when.
 */

// Sub-document: A single historical rate change entry
const rateChangeSchema = new mongoose.Schema(
  {
    changedBy: {
      // Reference to the SharedUser (admin) who made the change
      type: mongoose.Schema.Types.ObjectId,
      ref: "SharedUser",
      required: true,
    },
    previousOnlineRate: { type: Number, required: true },
    previousOfflineRate: { type: Number, required: true },
    newOnlineRate: { type: Number, required: true },
    newOfflineRate: { type: Number, required: true },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const commissionConfigSchema = new mongoose.Schema(
  {
    // ── Active Rates ──────────────────────────────────────────────────────────
    // Percentage values (e.g., 15 = 15%)
    onlineCommissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 15, // Default: 15% for online consultations
    },

    offlineCommissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 10, // Default: 10% for offline consultations
    },

    // ── Audit Trail ───────────────────────────────────────────────────────────
    // Full history of every commission rate change
    changeHistory: {
      type: [rateChangeSchema],
      default: [],
    },
  },
  { timestamps: true },
);

export default mongoose.model("CommissionConfig", commissionConfigSchema);
