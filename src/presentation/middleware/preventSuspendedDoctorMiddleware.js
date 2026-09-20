// src/presentation/middleware/preventSuspendedDoctorMiddleware.js
import SharedUser from "../../infrastructure/database/models/SharedUser.js";
import Appointment from "../../infrastructure/database/models/Appointment.js";

/**
 * 🛡️ Global Security Shield for Suspended Doctors
 * 
 * Intercepts mutating requests (POST, PUT, PATCH, DELETE) originating from Doctors.
 * If the doctor's account status is 'suspended':
 *  - Rejects the request with HTTP 403 Forbidden.
 *  - Exception: Whitelists finalizing the currently ongoing/active consultation
 *    (e.g., /:id/end-call, /:id/complete-offline, /:id/prescriptions, /:id/clinical-notes).
 * 
 * Read-only methods (GET, HEAD, OPTIONS) and harmless push notifications (PATCH /fcm-token)
 * pass through so the doctor can view their dashboard and suspension details.
 */
export const preventSuspendedDoctorAction = async (req, res, next) => {
  try {
    // Only doctors are affected by this check
    if (!req.user || req.user.role !== "doctor") {
      return next();
    }

    // Safe / Read-only HTTP methods are permitted
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next();
    }

    // Allow FCM token registration so device push notices from admin reach the doctor
    if (req.method === "PATCH" && req.originalUrl?.includes("/fcm-token")) {
      return next();
    }

    // Real-time DB lookup avoids stale JWT bypass (token can remain valid for up to 15 mins)
    const userId = req.user.id || req.user._id;
    const sharedUser = await SharedUser.findById(userId).select("accountStatus profileId");

    if (!sharedUser || sharedUser.accountStatus !== "suspended") {
      return next();
    }

    // ── Active Consultation Whitelist Exception ──
    // If the request is finalizing or recording notes for an ongoing consultation,
    // allow it so the active consultation can conclude naturally.
    const appointmentId = req.params?.id;
    const isConcludeAction =
      req.originalUrl?.includes("/end-call") ||
      req.originalUrl?.includes("/complete-offline") ||
      req.originalUrl?.includes("/prescriptions") ||
      req.originalUrl?.includes("/clinical-notes") ||
      req.originalUrl?.includes("/consultation-files");

    if (appointmentId && isConcludeAction && sharedUser.profileId) {
      const appointment = await Appointment.findOne({
        _id: appointmentId,
        doctorId: sharedUser.profileId,
      });

      if (appointment) {
        const isOngoing =
          appointment.status === "in_progress" ||
          (appointment.status === "scheduled" &&
            (appointment.sessionStartedAt ||
              appointment.offlineOTPVerifiedAt ||
              appointment.participantsConnectedAt ||
              appointment.doctorJoinedAt));

        if (isOngoing) {
          return next();
        }
      }
    }

    // All other mutating actions are blocked with 403 Forbidden
    return res.status(403).json({
      success: false,
      code: "ACCOUNT_SUSPENDED",
      message:
        "Your doctor account has been suspended by the administrator. Modifying schedules, slots, or bookings is prohibited.",
    });
  } catch (error) {
    console.error("[preventSuspendedDoctorAction] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during authorization check",
    });
  }
};
