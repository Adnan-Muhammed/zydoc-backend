import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// ── Inline Appointment schema (mirrors src/infrastructure/database/models/Appointment.js)
const appointmentSchema = new mongoose.Schema(
  {
    appointmentDate:    { type: Date },
    appointmentTime:    { type: String },
    scheduledStartAt:   { type: Date },
    scheduledEndAt:     { type: Date },
    lateJoinCutoffAt:   { type: Date },
    patientJoinedAt:    { type: Date },
    doctorJoinedAt:     { type: Date },
    sessionEndedAt:     { type: Date },
    status:             { type: String },
    consultationType:   { type: String },
  },
  { strict: false, timestamps: true }
);

const Appointment =
  mongoose.models.Appointment ||
  mongoose.model("Appointment", appointmentSchema);

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Format a Date to time-only IST string  e.g.  03:10:00 pm  IST */
function fmtIST(date) {
  if (!date) return "── not set ──";
  return (
    new Date(date).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }) + "  IST"
  );
}

/** Format a Date as UTC ISO string */
function fmtUTC(date) {
  if (!date) return "── not set ──";
  return new Date(date).toISOString().replace("T", "  ").replace("Z", "  UTC");
}

/** Diff two dates → "X min Y sec" string (or N/A) */
function diffStr(from, to) {
  if (!from || !to) return "N/A";
  const ms  = Math.abs(new Date(to) - new Date(from));
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return min > 0 ? `${min} min ${sec} sec` : `${sec} sec`;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("\n✅  MongoDB connected →", process.env.MONGO_URI);

    // Fetch the most recently-created appointment
    const appt = await Appointment.findOne().sort({ createdAt: -1 }).lean();

    if (!appt) {
      console.log("\n⚠️   No appointment documents found in the collection.\n");
      return;
    }

    // ── Pretty print ─────────────────────────────────────────────────────────
    const divider = "─".repeat(64);

    console.log(`\n${divider}`);
    console.log("  📋  LATEST APPOINTMENT  —  _id:", appt._id?.toString());
    console.log(`${divider}`);

    console.log("\n  ── Booking Info ──────────────────────────────────────────");
    console.log(`  appointmentDate    :  ${fmtIST(appt.appointmentDate)}`);
    console.log(`                        ${fmtUTC(appt.appointmentDate)}`);
    console.log(`  appointmentTime    :  ${appt.appointmentTime ?? "── not set ──"}`);
    console.log(`  status             :  ${appt.status            ?? "── not set ──"}`);
    console.log(`  consultationType   :  ${appt.consultationType  ?? "── not set ──"}`);

    console.log("\n  ── Scheduled Slot ────────────────────────────────────────");
    console.log(`  scheduledStartAt   :  ${fmtIST(appt.scheduledStartAt)}`);
    console.log(`                        ${fmtUTC(appt.scheduledStartAt)}`);
    console.log(`  scheduledEndAt     :  ${fmtIST(appt.scheduledEndAt)}`);
    console.log(`                        ${fmtUTC(appt.scheduledEndAt)}`);
    console.log(`  lateJoinCutoffAt   :  ${fmtIST(appt.lateJoinCutoffAt)}`);
    console.log(`                        ${fmtUTC(appt.lateJoinCutoffAt)}`);

    console.log("\n  ── Join Events ───────────────────────────────────────────");
    console.log(`  patientJoinedAt    :  ${fmtIST(appt.patientJoinedAt)}`);
    console.log(`                        ${fmtUTC(appt.patientJoinedAt)}`);
    console.log(`  doctorJoinedAt     :  ${fmtIST(appt.doctorJoinedAt)}`);
    console.log(`                        ${fmtUTC(appt.doctorJoinedAt)}`);

    console.log("\n  ── Session Lifecycle ─────────────────────────────────────");
    console.log(`  sessionEndedAt     :  ${fmtIST(appt.sessionEndedAt)}`);
    console.log(`                        ${fmtUTC(appt.sessionEndedAt)}`);

    console.log("\n  ── Derived Durations ─────────────────────────────────────");
    console.log(`  Slot window              :  ${diffStr(appt.scheduledStartAt, appt.scheduledEndAt)}`);
    console.log(`  Patient joined early by  :  ${diffStr(appt.patientJoinedAt, appt.scheduledStartAt)}`);
    console.log(`  Doctor  joined early by  :  ${diffStr(appt.doctorJoinedAt,  appt.scheduledStartAt)}`);
    const sessionFrom = appt.patientJoinedAt ?? appt.doctorJoinedAt;
    console.log(`  Session duration         :  ${diffStr(sessionFrom, appt.sessionEndedAt)}`);

    console.log(`\n${divider}\n`);

  } catch (err) {
    console.error("\n❌  Error:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("🔌  MongoDB disconnected.\n");
  }
}

main();