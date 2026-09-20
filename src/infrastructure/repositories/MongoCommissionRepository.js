// src/infrastructure/repositories/MongoCommissionRepository.js

import { CommissionRepository } from "../../domain/repositories/CommissionRepository.js";
import CommissionConfig from "../database/models/CommissionConfig.js";

/**
 * ── Mongo Commission Repository ───────────────────────────────────────────────
 * Concrete implementation of CommissionRepository backed by MongoDB/Mongoose.
 *
 * Singleton Design:
 *   The CommissionConfig collection always has exactly ONE document (seeded on boot).
 *   All reads and writes use findOne() / findOneAndUpdate() without a filter query,
 *   so they always target that single document.
 */
export class MongoCommissionRepository extends CommissionRepository {

  /**
   * Fetches the singleton CommissionConfig document.
   * Populates changedBy in changeHistory with the admin's email for readability.
   *
   * @returns {Promise<object>} The CommissionConfig document (lean).
   */
  async getConfig() {
    const config = await CommissionConfig.findOne()
      .populate({
        path: "changeHistory.changedBy",
        model: "SharedUser",
        select: "email role",
      })
      .lean();

    if (!config) {
      throw new Error(
        "CommissionConfig not found. Please run the database seeder."
      );
    }

    return config;
  }

  /**
   * Updates commission rates on the singleton document.
   * Only the rates explicitly provided are changed; the other stays the same.
   * A full audit entry (previous + new rates, who changed it, when) is appended
   * to the changeHistory array.
   *
   * @param {object} params
   * @param {number|null} params.onlineCommissionRate
   * @param {number|null} params.offlineCommissionRate
   * @param {string}      params.adminUserId
   * @param {string}      [params.note]
   * @returns {Promise<object>} The updated CommissionConfig document.
   */
  async updateRates({
    onlineCommissionRate,
    offlineCommissionRate,
    adminUserId,
    note = "",
  }) {
    // 1. Fetch current config to capture "previous" rates for the audit trail
    const current = await CommissionConfig.findOne().lean();
    if (!current) {
      throw new Error(
        "CommissionConfig not found. Please run the database seeder."
      );
    }

    // 2. Resolve final new rates (fall back to current value if not updating that rate)
    const newOnlineRate =
      onlineCommissionRate !== null && onlineCommissionRate !== undefined
        ? onlineCommissionRate
        : current.onlineCommissionRate;

    const newOfflineRate =
      offlineCommissionRate !== null && offlineCommissionRate !== undefined
        ? offlineCommissionRate
        : current.offlineCommissionRate;

    // 3. Guard: if nothing actually changed, skip the write and return current
    if (
      newOnlineRate === current.onlineCommissionRate &&
      newOfflineRate === current.offlineCommissionRate
    ) {
      throw new Error(
        "No changes detected. The provided rates are identical to the current rates."
      );
    }

    // 4. Build the audit history entry
    const historyEntry = {
      changedBy: adminUserId,
      previousOnlineRate: current.onlineCommissionRate,
      previousOfflineRate: current.offlineCommissionRate,
      newOnlineRate,
      newOfflineRate,
      note: note.trim(),
      changedAt: new Date(),
    };

    // 5. Atomic update: update rates + push history entry in a single DB round-trip
    const updated = await CommissionConfig.findByIdAndUpdate(
      current._id,
      {
        $set: {
          onlineCommissionRate: newOnlineRate,
          offlineCommissionRate: newOfflineRate,
        },
        $push: {
          changeHistory: historyEntry,
        },
      },
      {
        new: true,       // Return the updated document
        runValidators: true, // Enforce schema min/max constraints
      }
    ).populate({
      path: "changeHistory.changedBy",
      model: "SharedUser",
      select: "email role",
    });

    return updated;
  }
}
