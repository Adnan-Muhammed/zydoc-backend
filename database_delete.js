import "dotenv/config";
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/zydoc-app";

/**
 * Collections that MUST NOT be deleted.
 * All other collections will be completely dropped from the database.
 */
const PRESERVED_COLLECTIONS = new Set([
  "admins",
  "doctors",
  "patients",
  "sharedusers",
]);

async function deleteDatabaseCollections() {
  try {
    console.log("🔌 Connecting to MongoDB...");
    console.log(`📍 URI: ${MONGO_URI}`);
    await mongoose.connect(MONGO_URI);

    const db = mongoose.connection.db;
    console.log(`✅ Connected successfully to database: "${db.databaseName}"\n`);

    // Fetch all existing collections from the database
    const collections = await db.listCollections().toArray();

    if (collections.length === 0) {
      console.log("ℹ️ No collections found in the database.");
      return;
    }

    console.log(`🔍 Found ${collections.length} collection(s) in database. Evaluating...\n`);

    let droppedCount = 0;
    let preservedCount = 0;

    for (const col of collections) {
      const name = col.name;
      const lowerName = name.toLowerCase();

      // Skip MongoDB internal system collections
      if (lowerName.startsWith("system.")) {
        continue;
      }

      // Check if collection is one of the preserved collections
      if (PRESERVED_COLLECTIONS.has(lowerName)) {
        const count = await db.collection(name).countDocuments();
        console.log(`🛡️  PRESERVED: "${name}" (${count} documents retained)`);
        preservedCount++;
      } else {
        try {
          const count = await db.collection(name).countDocuments();
          await db.dropCollection(name);
          console.log(`🗑️  DROPPED:   "${name}" (${count} documents deleted)`);
          droppedCount++;
        } catch (err) {
          // MongoDB error 26 means the collection was already dropped / does not exist
          if (err.code === 26) {
            console.log(`ℹ️ Collection "${name}" does not exist, skipping.`);
          } else {
            console.error(`❌ Error dropping collection "${name}":`, err.message);
          }
        }
      }
    }

    console.log("\n=================================");
    console.log("🎉 Database Cleanup Summary:");
    console.log(`   - Preserved: ${preservedCount} collection(s) (admins, doctors, patients, sharedusers)`);
    console.log(`   - Dropped:   ${droppedCount} collection(s)`);
    console.log("=================================\n");
  } catch (error) {
    console.error("💥 Fatal error during database cleanup:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB.");
    process.exit(0);
  }
}

deleteDatabaseCollections();
