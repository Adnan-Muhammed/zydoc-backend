/**
 * Migration: add_slot_lock_unique_index
 *
 * Adds a unique partial index to the `appointments` collection that prevents
 * two active (locked / scheduled / completed) records from ever sharing the
 * same (doctorId, appointmentDate, appointmentTime) combination.
 *
 * The `partialFilterExpression` limits the uniqueness guarantee to only the
 * statuses that truly "occupy" a slot.  Cancelled / refunded / expired-locked
 * rows are excluded so that historical data never blocks a future booking of
 * the same slot.
 *
 * Run once against your database:
 *   node src/infrastructure/database/migrations/add_slot_lock_unique_index.js
 */

import mongoose from "mongoose";
import { DB_URI } from "../../config/env.js"; // adjust import to your env helper

async function up() {
    await mongoose.connect(DB_URI);
    const db = mongoose.connection.db;
    const collection = db.collection("appointments");

    await collection.createIndex(
        {
            doctorId: 1,
            appointmentDate: 1,
            appointmentTime: 1,
        },
        {
            unique: true,
            // Only enforce uniqueness on ACTIVE statuses.
            // 'locked' rows with an expired lockExpiryTime are cleaned up before
            // the upsert, so they will never block a legitimate new lock.
            partialFilterExpression: {
                status: { $in: ["locked", "scheduled", "completed"] },
            },
            name: "unique_active_slot_per_doctor",
            background: true,
        }
    );

    console.log("✅ Index 'unique_active_slot_per_doctor' created successfully.");
    await mongoose.disconnect();
}

up().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
});
