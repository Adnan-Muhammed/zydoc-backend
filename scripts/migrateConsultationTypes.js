/**
 * Purpose: One-time MongoDB data migration that changes legacy appointment
 * consultationType values from "video" to "online" and "physical" to "offline".
 * Usage: From the backend root, run `node scripts/migrateConsultationTypes.js`.
 * The call at the bottom runs on module evaluation, so do not import this file
 * into the application. It loads ../.env and uses MONGO_URI, falling back to
 * mongodb://127.0.0.1:27017/zydoc-app when MONGO_URI is unset.
 * Dependencies: mongoose for the connection and appointments collection,
 * dotenv for environment loading, and Node.js path/url utilities.
 * Origin: Git history added this file in commit 5ef7f6f ("video call sidebar
 * implemenations", 2026-09-12). The exact original request is not recorded;
 * the migration intent is established by the transformations below.
 * Current relevance: No application startup or package script references it.
 * Application repository code still accepts both old and new values, so this
 * utility is not required for normal application operation.
 * When needed: Run only when a specifically selected database contains legacy
 * values, such as after restoring or importing older appointment data.
 * Production impact: Operational maintenance utility, not part of server
 * startup. It updates matching documents in appointments; it does not delete
 * them. It is not transaction-wrapped and should be preceded by a backup.
 * Risks: It immediately connects and writes when executed or imported. It logs
 * the full MongoDB URI, which may expose credentials in logs. Errors are logged
 * but not rethrown, so a successful process exit alone does not prove success.
 * Recommendation: Retain only while legacy data may need migration; otherwise
 * consider future removal after verifying every relevant database.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/zydoc-app";

async function migrate() {
    try {
        console.log("Connecting to MongoDB:", MONGO_URI);
        await mongoose.connect(MONGO_URI);
        console.log("Connected successfully.");

        const db = mongoose.connection.db;
        const appointmentsColl = db.collection("appointments");

        const videoCount = await appointmentsColl.countDocuments({ consultationType: "video" });
        const physicalCount = await appointmentsColl.countDocuments({ consultationType: "physical" });

        console.log(`Found ${videoCount} 'video' appointments and ${physicalCount} 'physical' appointments.`);

        if (videoCount > 0) {
            const resVideo = await appointmentsColl.updateMany(
                { consultationType: "video" },
                { $set: { consultationType: "online" } }
            );
            console.log(`✅ Migrated ${resVideo.modifiedCount} appointments from 'video' to 'online'.`);
        }

        if (physicalCount > 0) {
            const resPhysical = await appointmentsColl.updateMany(
                { consultationType: "physical" },
                { $set: { consultationType: "offline" } }
            );
            console.log(`✅ Migrated ${resPhysical.modifiedCount} appointments from 'physical' to 'offline'.`);
        }

        console.log("Migration complete!");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        await mongoose.disconnect();
        console.log("Disconnected from MongoDB.");
    }
}

migrate();
