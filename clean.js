import mongoose from "mongoose";

const MONGO_URI = "mongodb://127.0.0.1:27017/zydoc-app";

async function cleanDatabase() {
    try {
        console.log("Connecting to database...");
        await mongoose.connect(MONGO_URI);
        console.log("Connected successfully to MongoDB.");

        const collectionsToDrop = ['appointments', 'notifications', 'transactions'];

        for (const collectionName of collectionsToDrop) {
            try {
                // Drop the collection
                await mongoose.connection.db.dropCollection(collectionName);
                console.log(`✅ Successfully dropped collection: ${collectionName}`);
            } catch (err) {
                // Error code 26 means the collection doesn't exist
                if (err.code === 26) {
                    console.log(`ℹ️ Collection '${collectionName}' does not exist, skipping.`);
                } else {
                    console.error(`❌ Error dropping collection '${collectionName}':`, err.message);
                }
            }
        }
        
        console.log("🎉 Database cleanup complete!");
    } catch (error) {
        console.error("Database connection error:", error);
    } finally {
        await mongoose.disconnect();
        console.log("Database connection closed.");
        process.exit(0);
    }
}

cleanDatabase();
