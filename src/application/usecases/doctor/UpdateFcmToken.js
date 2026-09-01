// src/application/usecases/doctor/UpdateFcmToken.js

import SharedUser from "../../../infrastructure/database/models/SharedUser.js";
import Doctor from "../../../infrastructure/database/models/DoctorProfile.js";

/**
 * UpdateFcmToken — Application Use Case
 *
 * Receives a doctor's userId (from the JWT) and their new FCM registration token,
 * then persists the token directly on their Doctor profile document.
 *
 * Design decisions:
 * - We query SharedUser to resolve the profileId, then update Doctor directly.
 *   This avoids loading the entire UserRepository chain for a simple field update.
 * - Passing `null` as the token is a valid "unregister" operation (e.g. on logout).
 * - This use case deliberately has no knowledge of FCM internals — it only stores the token.
 *
 * @param {string} userId   - The SharedUser._id from the authenticated JWT.
 * @param {string|null} fcmToken - The FCM registration token from the browser client.
 * @returns {Promise<void>}
 */
export class UpdateFcmToken {
  async execute(userId, fcmToken) {
    if (!userId) {
      throw new Error("UserId is required to update FCM token.");
    }

    // Resolve the doctor's profile from the shared-user record
    const sharedUser = await SharedUser.findById(userId).select("profileId role");

    if (!sharedUser) {
      throw new Error("User not found.");
    }

    if (sharedUser.role.toLowerCase() !== "doctor") {
      throw new Error("Only doctor accounts can register an FCM token.");
    }

    if (!sharedUser.profileId) {
      throw new Error("Doctor profile has not been created yet.");
    }

    // Update only the fcmToken field — $set is atomic and won't touch other fields
    await Doctor.findByIdAndUpdate(
      sharedUser.profileId,
      { $set: { fcmToken: fcmToken ?? null } },
      { returnDocument: 'after' }
    );

    console.log(
      `[UpdateFcmToken] ✅ FCM token ${fcmToken ? "updated" : "cleared"} for doctor profile: ${sharedUser.profileId}`
    );
  }
}
