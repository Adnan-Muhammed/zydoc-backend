/**
 * Migration: fix_scheduled_times_utc_offset
 *
 * Context:
 *   Prior to the UTC refactor, `getSlotExactUTC()` subtracted a hardcoded 5.5-hour
 *   IST offset from the parsed slot time before storing it.  This meant every
 *   `scheduledStartAt` / `scheduledEndAt` in the database is 5h 30m BEHIND the
 *   correct absolute UTC value.
 *
 * What this script does:
 *   Iterates all appointments that have `scheduledStartAt` set, in configurable
 *   batches, and adds +19800000 ms (5h 30m = IST offset) to both
 *   `scheduledStartAt` and `scheduledEndAt` using MongoDB bulkWrite — no document
 *   round-trips, no Mongoose overhead, no data loss risk.
 *
 * Safety features:
 *   - DRY_RUN mode (default ON) — prints what would change without writing.
 *   - Idempotency guard via a `utcOffsetFixed` boolean flag set on each doc;
 *     re-running the script will skip already-migrated documents.
 *   - Configurable BATCH_SIZE to avoid locking the collection on large datasets.
 *   - Full summary log at the end.
 *
 * Run (dry run — inspect output first):
 *   node src/infrastructure/database/migrations/fix_scheduled_times_utc_offset.js
 *
 * Run (apply changes):
 *   DRY_RUN=false node src/infrastructure/database/migrations/fix_scheduled_times_utc_offset.js
 *
 * ⚠️  Always take a database backup before running any migration in production.
 */

import mongoose from 'mongoose';
import { DB_URI } from '../../config/env.js';

// ── Configuration ─────────────────────────────────────────────────────────────
const OFFSET_MS   = 5.5 * 60 * 60 * 1000; // 19 800 000 ms — IST ahead of UTC
const BATCH_SIZE  = 200;                    // documents processed per iteration
const DRY_RUN     = process.env.DRY_RUN !== 'false'; // default ON for safety
// ─────────────────────────────────────────────────────────────────────────────

async function up() {
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Migration: fix_scheduled_times_utc_offset');
    console.log(`  Mode    : ${DRY_RUN ? '🔍 DRY RUN (no writes)' : '✏️  LIVE (writes enabled)'}`);
    console.log(`  Offset  : +${OFFSET_MS} ms  (+5h 30m)`);
    console.log(`  Batch   : ${BATCH_SIZE} docs`);
    console.log('══════════════════════════════════════════════════════════');
    console.log('');

    await mongoose.connect(DB_URI);
    console.log(`✅ Connected to MongoDB`);

    const db         = mongoose.connection.db;
    const collection = db.collection('appointments');

    // ── Stats ─────────────────────────────────────────────────────────────────
    let totalScanned = 0;
    let totalUpdated = 0;
    let batchIndex   = 0;

    // ── Filter: only docs that have scheduledStartAt and haven't been fixed yet
    const filter = {
        scheduledStartAt: { $exists: true, $ne: null },
        utcOffsetFixed:   { $ne: true },   // idempotency guard
    };

    const totalPending = await collection.countDocuments(filter);

    if (totalPending === 0) {
        console.log('ℹ️  No documents need migration (all already fixed or have no scheduledStartAt).');
        await mongoose.disconnect();
        return;
    }

    console.log(`📋 Documents pending migration: ${totalPending}`);
    console.log('');

    // ── Batch loop using async cursor ─────────────────────────────────────────
    const cursor = collection.find(filter, {
        projection: { _id: 1, scheduledStartAt: 1, scheduledEndAt: 1, status: 1 },
        batchSize: BATCH_SIZE,
    });

    const batch = [];

    const flushBatch = async () => {
        if (batch.length === 0) return;
        batchIndex++;
        totalScanned += batch.length;

        if (DRY_RUN) {
            // Preview first 3 docs of this batch — no writes performed
            const preview = batch.slice(0, 3);
            console.log(`  [Batch ${batchIndex}] Would update ${batch.length} doc(s). Sample:`);
            for (const doc of preview) {
                const oldStart = doc.scheduledStartAt
                    ? new Date(doc.scheduledStartAt).toISOString()
                    : 'null';
                const newStart = doc.scheduledStartAt
                    ? new Date(new Date(doc.scheduledStartAt).getTime() + OFFSET_MS).toISOString()
                    : 'null';
                console.log(`    _id: ${doc._id}  |  status: ${doc.status || '?'}`);
                console.log(`      scheduledStartAt: ${oldStart}  →  ${newStart}`);
            }
            if (batch.length > 3) {
                console.log(`    ... and ${batch.length - 3} more doc(s) in this batch`);
            }
            totalUpdated += batch.length;
        } else {
            // Build a bulkWrite array — one updateOne per document
            const ops = batch.map(doc => {
                const setFields = { utcOffsetFixed: true };

                if (doc.scheduledStartAt) {
                    setFields.scheduledStartAt = new Date(
                        new Date(doc.scheduledStartAt).getTime() + OFFSET_MS
                    );
                }
                if (doc.scheduledEndAt) {
                    setFields.scheduledEndAt = new Date(
                        new Date(doc.scheduledEndAt).getTime() + OFFSET_MS
                    );
                }

                return {
                    updateOne: {
                        filter: { _id: doc._id },
                        update: { $set: setFields },
                    },
                };
            });

            const result = await collection.bulkWrite(ops, { ordered: false });
            totalUpdated += result.modifiedCount;

            console.log(
                `  [Batch ${batchIndex}] Processed ${batch.length} ` +
                `| Modified: ${result.modifiedCount} ` +
                `| Matched: ${result.matchedCount}`
            );
        }

        batch.length = 0; // clear buffer for next batch
    };

    for await (const doc of cursor) {
        batch.push(doc);
        if (batch.length >= BATCH_SIZE) {
            await flushBatch();
        }
    }

    // Flush any remaining docs smaller than one full batch
    await flushBatch();

    // ── Final Summary ─────────────────────────────────────────────────────────
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    if (DRY_RUN) {
        console.log('  ✅ Dry run complete — NO DATA WRITTEN');
    } else {
        console.log('  ✅ Migration complete');
    }
    console.log(`  Total scanned  : ${totalScanned}`);
    console.log(`  Total updated  : ${totalUpdated}`);
    console.log(`  Batches run    : ${batchIndex}`);
    if (DRY_RUN) {
        console.log('');
        console.log('  ▶  To apply changes, run:');
        console.log('     DRY_RUN=false node src/infrastructure/database/migrations/fix_scheduled_times_utc_offset.js');
    }
    console.log('══════════════════════════════════════════════════════════');
    console.log('');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
}

up().catch((err) => {
    console.error('');
    console.error('❌ Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
});
