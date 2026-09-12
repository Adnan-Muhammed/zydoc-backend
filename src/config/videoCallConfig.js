// src/config/videoCallConfig.js
//
// ╔═══════════════════════════════════════════════════════════════════════════════╗
// ║                                                                             ║
// ║   VIDEO CALL TIMING CONFIGURATION — SINGLE SOURCE OF TRUTH (BACKEND)        ║
// ║                                                                             ║
// ║   All timing constants for the teleconsultation timer system live here.      ║
// ║   Change any value below and the entire system adapts automatically.         ║
// ║   NO other files need to be modified.                                        ║
// ║                                                                             ║
// ║   ⚠️  IMPORTANT: If you change MAX_EXTENSION_MINUTES here, also update      ║
// ║       the mirrored constant in the FRONTEND config file:                     ║
// ║       zydoc-frontend/src/config/videoCallConfig.ts                           ║
// ║                                                                             ║
// ╚═══════════════════════════════════════════════════════════════════════════════╝

/**
 * MAX_EXTENSION_MINUTES
 * ─────────────────────
 * The MAXIMUM extra time (in minutes) a doctor can extend a call AFTER the
 * base duration ends.
 *
 * Example: If base duration is 10 min and MAX_EXTENSION_MINUTES is 10,
 *          the absolute longest a call can run is 20 min (10 base + 10 ext).
 *
 * ⭐ TO CHANGE: Simply update the number below (e.g., 10 → 15).
 *    No other code changes are needed.
 *
 * Current value: 10 minutes
 */
export const MAX_EXTENSION_MINUTES = 10;

/**
 * WRAP_UP_COUNTDOWN_SECONDS
 * ─────────────────────────
 * The strict, non-reversible countdown (in seconds) that plays before the
 * call is forcefully terminated. Once this countdown starts, it CANNOT be
 * cancelled — even if the next patient leaves the waiting room.
 *
 * Current value: 60 seconds (1 minute)
 */
export const WRAP_UP_COUNTDOWN_SECONDS = 60;

/**
 * DEFAULT_BASE_DURATION_MINUTES
 * ─────────────────────────────
 * Fallback base duration when the appointment's scheduledStartAt / scheduledEndAt
 * fields are missing or cannot be parsed. The preferred calculation is:
 *     baseDuration = scheduledEndAt - scheduledStartAt
 *
 * Current value: 10 minutes
 */
export const DEFAULT_BASE_DURATION_MINUTES = 10;
