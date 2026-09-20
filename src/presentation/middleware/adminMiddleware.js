// src/presentation/middleware/adminMiddleware.js

/**
 * ── Admin Middleware (RBAC) ────────────────────────────────────────────────────
 *
 * Usage pattern in routes:
 *   router.get("/path", protect, adminOnly, handler);
 *   router.post("/path", protect, requirePermission("manage_refunds"), handler);
 *   router.delete("/path", protect, superAdminOnly, handler);
 *
 * NOTE: All functions below assume `protect` middleware has already run and
 * populated `req.user` from the JWT payload.
 */

// ── 1. isAdmin / adminOnly ────────────────────────────────────────────────────
/**
 * Gate: user must be authenticated AND have role === "admin".
 * This is the BASE guard; always compose it first before permission checks.
 */
export const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
    });
  }

  next();
};

// Alias — plan refers to "isAdmin" in some route files
export const isAdmin = adminOnly;

// ── 2. superAdminOnly ─────────────────────────────────────────────────────────
/**
 * Gate: user must be an admin AND have isSuperAdmin === true in their JWT payload.
 * Used for destructive or irreversible actions (e.g. suspend accounts, change commission).
 *
 * For this to work, isSuperAdmin must be included in the JWT payload when
 * generating the access token in JwtService.generateAccessToken().
 */
export const superAdminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Access denied. Admin privileges required.",
    });
  }

  if (!req.user.isSuperAdmin) {
    return res.status(403).json({
      success: false,
      message: "Access denied. Super Admin privileges required for this action.",
    });
  }

  next();
};

// ── 3. requirePermission (Granular RBAC) ─────────────────────────────────────
/**
 * Factory: returns middleware that checks if the admin has a specific permission
 * OR is a super-admin (super_admin bypasses all permission checks).
 *
 * Available permissions (mirrors AdminProfile enum):
 *   "manage_users"   | "manage_doctors" | "view_reports"
 *   "system_settings"| "manage_refunds" | "manage_payouts"
 *   "full_access"
 *
 * @param {string | string[]} requiredPermissions - One or more required permissions.
 *        If an array is provided, the admin must have AT LEAST ONE of them.
 *
 * @example
 *   router.post("/refunds/:id/approve", protect, requirePermission("manage_refunds"), handler);
 *   router.get("/reports", protect, requirePermission(["view_reports", "full_access"]), handler);
 */
export const requirePermission = (requiredPermissions) => {
  // Normalize to array
  const permissions = Array.isArray(requiredPermissions)
    ? requiredPermissions
    : [requiredPermissions];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (req.user.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin privileges required.",
      });
    }

    // Super admins and full_access holders bypass permission checks
    if (
      req.user.isSuperAdmin ||
      (Array.isArray(req.user.permissions) &&
        req.user.permissions.includes("full_access"))
    ) {
      return next();
    }

    // Check if the admin holds at least one of the required permissions
    const hasPermission =
      Array.isArray(req.user.permissions) &&
      req.user.permissions.some((p) => permissions.includes(p));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required permission: ${permissions.join(" or ")}.`,
      });
    }

    next();
  };
};

// ── 4. Convenience Composed Guards ───────────────────────────────────────────
// Pre-built guards for the most common admin actions.
// Import these directly into route files for cleaner code.

/** Guard for user (doctor/patient) management routes */
export const canManageUsers = requirePermission([
  "manage_users",
  "full_access",
]);

/** Guard for doctor management routes */
export const canManageDoctors = requirePermission([
  "manage_doctors",
  "full_access",
]);

/** Guard for refund approval routes */
export const canManageRefunds = requirePermission([
  "manage_refunds",
  "full_access",
]);

/** Guard for payout and financial routes */
export const canManagePayouts = requirePermission([
  "manage_payouts",
  "full_access",
]);

/** Guard for viewing analytics and reports */
export const canViewReports = requirePermission([
  "view_reports",
  "full_access",
]);

/** Guard for system settings (commission config, etc.) */
export const canManageSettings = requirePermission([
  "system_settings",
  "full_access",
]);
