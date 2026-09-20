// src/infrastructure/database/models/AdminProfile.js
import mongoose from "mongoose";

// Sub-document: individual admin action audit trail entry
const activityLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      trim: true,
      // e.g. "DOCTOR_APPROVED", "REFUND_APPROVED", "COMMISSION_UPDATED"
    },
    targetId: {
      // The ID of the entity acted upon (doctor, refund ticket, etc.)
      type: mongoose.Schema.Types.ObjectId,
    },
    targetModel: {
      // Discriminator so we know which collection targetId belongs to
      type: String,
      trim: true,
      // e.g. "Doctor", "RefundTicket", "CommissionConfig"
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    performedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // ── RBAC ────────────────────────────────────────────────────────────────
    // Coarse role that drives UI menu visibility and permission checks
    adminRole: {
      type: String,
      enum: ["super_admin", "support", "finance"],
      default: "support",
    },

    permissions: {
      type: [String],
      enum: [
        "manage_users",
        "manage_doctors",
        "view_reports",
        "system_settings",
        "manage_refunds",
        "manage_payouts",
        "full_access",
      ],
      default: ["full_access"],
    },

    isSuperAdmin: {
      type: Boolean,
      default: false,
    },

    department: {
      type: String,
      default: "Management",
    },

    // ── Session Tracking ─────────────────────────────────────────────────────
    lastLoginAt: {
      type: Date,
      default: null,
    },

    // ── Audit Trail ──────────────────────────────────────────────────────────
    // Capped at 200 most-recent actions to avoid document bloat.
    // For full history, emit events to a dedicated AuditLog collection.
    adminActivityLog: {
      type: [activityLogSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

// Adding an index on name for quick lookups in the admin panel
adminSchema.index({ name: 1 });
adminSchema.index({ adminRole: 1 });

export default mongoose.model("Admin", adminSchema);
