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
 * EARLY_JOIN_MINUTES
 * ──────────────────
 * The earliest boundary (in minutes before ScheduledStartAt) at which
 * a patient is permitted to enter the waiting room.
 *
 * Current value: 10 minutes
 */
export const EARLY_JOIN_MINUTES = 10;

/**
 * EARLY_START_MINUTES
 * ───────────────────
 * The earliest boundary (in minutes before ScheduledStartAt) at which
 * the live consultation call can be initiated (EarlyStartAt = ScheduledStartAt - 7 min).
 *
 * Current value: 7 minutes
 */
export const EARLY_START_MINUTES = 7;

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
 * The strict, non-reversible auto-cut countdown (in seconds) that plays before the
 * call is forcefully terminated when the next patient goes live or at hard limit.
 *
 * Current value: 20 seconds (Rule 2 auto-cut standard)
 */
export const WRAP_UP_COUNTDOWN_SECONDS = 20;

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

/**
 * MIN_CONSULTATION_DURATION_SECONDS
 * ─────────────────────────────────
 * Minimum required active consultation time (in seconds) before the doctor
 * is permitted to conclude the consultation (Rule 4).
 *
 * Current value: 180 seconds (3 minutes)
 */
export const MIN_CONSULTATION_DURATION_SECONDS = 180;

/**
 * RECONNECTION_GRACE_SECONDS
 * ──────────────────────────
 * Grace period (in seconds) buffered upon socket disconnect to allow participants
 * to seamlessly re-establish WebRTC without room tear-down (Rule 6).
 *
 * Current value: 30 seconds
 */
export const RECONNECTION_GRACE_SECONDS = 30;
