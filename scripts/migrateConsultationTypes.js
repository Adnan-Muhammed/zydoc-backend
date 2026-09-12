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
