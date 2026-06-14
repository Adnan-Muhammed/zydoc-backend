import mongoose from "mongoose";

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    permissions: {
      type: [String],
      enum: [
        "manage_users",
        "manage_doctors",
        "view_reports",
        "system_settings",
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
  },
  {
    timestamps: true,
  },
);

// Adding an index on name for quick lookups in the admin panel
adminSchema.index({ name: 1 });

export default mongoose.model("Admin", adminSchema);
