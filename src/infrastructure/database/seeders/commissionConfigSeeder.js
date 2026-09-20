// src/infrastructure/database/seeders/commissionConfigSeeder.js
/**
 * ── Commission Config Seeder ──────────────────────────────────────────────────
 * Ensures exactly ONE CommissionConfig document exists in the database.
 * Run this ONCE during initial server setup OR call it in server.js startup.
 *
 * Safe to call multiple times: uses findOneOrCreate logic (upsert: false).
 *
 * Usage:
 *   import { seedCommissionConfig } from "./seeders/commissionConfigSeeder.js";
 *   await seedCommissionConfig(); // in server.js after DB connect
 */
import CommissionConfig from "../models/CommissionConfig.js";

export const seedCommissionConfig = async () => {
  try {
    const existing = await CommissionConfig.findOne();

    if (existing) {
      console.log(
        `[Seeder] CommissionConfig already exists. Online: ${existing.onlineCommissionRate}%, Offline: ${existing.offlineCommissionRate}%`
      );
      return existing;
    }

    const defaultConfig = await CommissionConfig.create({
      onlineCommissionRate: 15,  // 15% for online consultations
      offlineCommissionRate: 10, // 10% for offline consultations
      changeHistory: [],
    });

    console.log(
      `[Seeder] CommissionConfig seeded with defaults — Online: 15%, Offline: 10%`
    );
    return defaultConfig;
  } catch (error) {
    console.error("[Seeder] Failed to seed CommissionConfig:", error.message);
    throw error;
  }
};
