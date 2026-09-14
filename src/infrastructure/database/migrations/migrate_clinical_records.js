/**
 * Migration: migrate_clinical_records.js
 *
 * Backfills past appointment clinical notes, structured prescriptions, and consultation files
 * from the embedded arrays in the `appointments` collection into the new `consultationrecords` collection.
 *
 * Safety features:
 *   - Idempotency guard: skips any appointment that already has a ConsultationRecord.
 *   - DRY_RUN support: run with DRY_RUN=true to inspect before writing.
 *   - Batch processing with summary logs.
 *
 * Run:
 *   node src/infrastructure/database/migrations/migrate_clinical_records.js
 */

import mongoose from "mongoose";
import { DB_URI } from "../../config/env.js";
import Appointment from "../models/Appointment.js";
import ConsultationRecord from "../models/ConsultationRecord.js";

const DRY_RUN = process.env.DRY_RUN === "true";

async function runMigration() {
  console.log("══════════════════════════════════════════════════════════");
  console.log("  Migration: migrate_clinical_records");
  console.log(`  Mode    : ${DRY_RUN ? "🔍 DRY RUN (no writes)" : "✏️  LIVE (writes enabled)"}`);
  console.log("══════════════════════════════════════════════════════════");

  await mongoose.connect(DB_URI);
  console.log(" Connected to MongoDB.");

  // Find appointments that have any clinical data
  const filter = {
    $or: [
      { clinicalNotes: { $exists: true, $ne: "" } },
      { "prescriptions.0": { $exists: true } },
      { "consultationFiles.0": { $exists: true } },
    ],
  };

  const totalCandidates = await Appointment.countDocuments(filter);
  console.log(`ℹ️  Found ${totalCandidates} appointments with clinical records.`);

  if (totalCandidates === 0) {
    console.log("✅ No records to migrate.");
    await mongoose.disconnect();
    return;
  }

  const cursor = Appointment.find(filter).cursor();
  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for await (const app of cursor) {
    try {
      // Idempotency check: does ConsultationRecord already exist for this appointment?
      const existing = await ConsultationRecord.findOne({ appointmentId: app._id });
      if (existing) {
        skippedCount++;
        // If appointment.consultationRecordId is not linked, link it
        if (!app.consultationRecordId && !DRY_RUN) {
          await Appointment.updateOne(
            { _id: app._id },
            { $set: { consultationRecordId: existing._id } }
          );
        }
        continue;
      }

      if (!DRY_RUN) {
        const record = await ConsultationRecord.create({
          appointmentId: app._id,
          doctorId: app.doctorId,
          patientId: app.patientId,
          clinicalNotes: app.clinicalNotes || "",
          prescriptions: app.prescriptions || [],
          consultationFiles: app.consultationFiles || [],
        });

        await Appointment.updateOne(
          { _id: app._id },
          { $set: { consultationRecordId: record._id } }
        );
      }

      migratedCount++;
      if (migratedCount % 25 === 0) {
        console.log(`   Migrated ${migratedCount} records so far...`);
      }
    } catch (err) {
      console.error(`❌ Failed to migrate appointment ${app._id}:`, err.message);
      errorCount++;
    }
  }

  console.log("══════════════════════════════════════════════════════════");
  console.log(` Migration complete!`);
  console.log(`   Migrated: ${migratedCount}`);
  console.log(`   Skipped (already migrated): ${skippedCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log("══════════════════════════════════════════════════════════");

  await mongoose.disconnect();
}

runMigration().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
