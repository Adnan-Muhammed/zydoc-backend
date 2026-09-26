// src/infrastructure/utils/timeUtils.js

/**
 * Parses time strings in either 24-hour ("14:30") or 12-hour ("02:30 PM") formats.
 * Returns { h: number, m: number } where h is 0-23.
 */
export function parseTimeStr(tStr) {
  if (!tStr) return { h: 0, m: 0 };
  const [timePart, modifier] = tStr.trim().split(/\s+/);
  let [h, m] = timePart.split(':').map(Number);
  if (isNaN(h)) h = 0;
  if (isNaN(m)) m = 0;

  if (modifier) {
    const modUpper = modifier.toUpperCase();
    if (modUpper === 'PM' && h < 12) h += 12;
    if (modUpper === 'AM' && h === 12) h = 0;
  }
  return { h, m };
}

/**
 * Formats 24-hour hours (0-23) and minutes (0-59) into 12-hour "hh:mm AM/PM" format.
 */
export function formatTo12H(h, m) {
  const period = (h >= 12 && h < 24) || h >= 24 ? 'PM' : 'AM';
  const hr12 = (h % 12) || 12;
  return `${String(hr12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Parses a date string ("YYYY-MM-DD" or ISO string) into [year, month, day] components.
 */
export function parseDateComponents(dateStr) {
  if (!dateStr) {
    const now = new Date();
    return [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()];
  }
  if (dateStr.includes('T')) {
    const d = new Date(dateStr);
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
  return dateStr.split(/[-/]/).slice(0, 3).map(Number);
}

/**
 * Returns UTC start-of-day and end-of-day Date objects for strict ISO queries.
 */
export function getUTCDayBounds(dateStr) {
  const [year, month, day] = parseDateComponents(dateStr);
  const startOfDayUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  const endOfDayUTC = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  return { startOfDayUTC, endOfDayUTC, year, month, day };
}

/**
 * Converts a date string ("YYYY-MM-DD") and a slot time string ("09:00 AM" or "14:30")
 * in a specific IANA timezone (e.g. "Asia/Kolkata", "America/New_York", "Europe/London")
 * into an absolute UTC Date object.
 *
 * Uses native Intl.DateTimeFormat to calculate the exact offset for the given timezone
 * on that specific calendar date (automatically accounting for Daylight Saving Time if applicable).
 */
export function getSlotExactUTC(dateStr, timeStr, timeZone = 'Asia/Kolkata') {
  const [year, month, day] = parseDateComponents(dateStr);
  const { h, m } = parseTimeStr(timeStr);

  const safeTimeZone = (timeZone && typeof timeZone === 'string' && timeZone.trim()) 
    ? timeZone.trim() 
    : 'Asia/Kolkata';

  try {
    const targetUtcGuess = new Date(Date.UTC(year, month - 1, day, h, m, 0, 0));
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: safeTimeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(targetUtcGuess);
    const map = {};
    for (const p of parts) map[p.type] = p.value;

    const localYear = parseInt(map.year, 10);
    const localMonth = parseInt(map.month, 10);
    const localDay = parseInt(map.day, 10);
    let localHour = parseInt(map.hour, 10);
    if (localHour === 24) localHour = 0;
    const localMinute = parseInt(map.minute, 10);

    const asLocal = Date.UTC(localYear, localMonth - 1, localDay, localHour, localMinute, 0, 0);
    const offsetMs = asLocal - targetUtcGuess.getTime();

    return new Date(targetUtcGuess.getTime() - offsetMs);
  } catch (err) {
    // Fallback if an invalid timezone string was provided: use Asia/Kolkata (+5.5h) default
    const fallbackOffsetMs = 5.5 * 60 * 60 * 1000;
    return new Date(Date.UTC(year, month - 1, day, h, m, 0, 0) - fallbackOffsetMs);
  }
}

/**
 * Safely resolves doctor's timezone string from a doctor document or plain object.
 */
export function getDoctorTimezone(doctor) {
  return doctor?.timezone || doctor?.doctorProfile?.timezone || 'Asia/Kolkata';
}

/**
 * Proportional late join grace period (in minutes) based on slot duration.
 * Formula: MIN(Duration * 25%, 10 minutes)
 * Master Table:
 * - 10m slot: 2m grace (Last Join = 9:02)
 * - 15m slot: 4m grace (Last Join = 9:04)
 * - 20m slot: 5m grace (Last Join = 9:05)
 * - 25m slot: 6m grace (Last Join = 9:06)
 * - 30m slot: 8m grace (Last Join = 9:08)
 * - 45m slot: 10m grace (Last Join = 9:10, capped at 10m)
 */
export function getLateJoinGraceMinutes(durationMinutes = 15) {
  const dur = Number(durationMinutes) || 15;
  const standardGraces = { 10: 2, 15: 4, 20: 5, 25: 6, 30: 8, 45: 10 };
  if (standardGraces[dur] !== undefined) {
    return standardGraces[dur];
  }
  return Math.min(10, Math.round(dur * 0.25));
}

/**
 * Returns the timestamp in milliseconds past which booking is locked/disallowed.
 * Equation: LastBookingAt = LastJoinAt - 5 minutes
 *           LastBookingAt = ScheduledStartAt + LateJoinGrace - 5 minutes
 */
export function getBookingCutoffMs(slotStartUTC, slotDuration = 15) {
  const startMs = slotStartUTC instanceof Date ? slotStartUTC.getTime() : new Date(slotStartUTC).getTime();
  const dur = Number(slotDuration) || 15;
  const graceMinutes = getLateJoinGraceMinutes(dur);
  return startMs + (graceMinutes - 5) * 60 * 1000;
}

/**
 * Calculates remaining available consultation minutes for an ongoing slot.
 */
export function getRemainingSlotMinutes(slotStartUTC, slotDuration = 15, now = new Date()) {
  const startMs = slotStartUTC instanceof Date ? slotStartUTC.getTime() : new Date(slotStartUTC).getTime();
  const endMs = startMs + (Number(slotDuration) || 15) * 60 * 1000;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Math.max(0, Math.round((endMs - nowMs) / 60000));
}

/**
 * Calculates consultation timing boundaries and start state based on
 * appointment-timing-rules.md (Part 1 & Master Table).
 *
 * States:
 * - EARLY: actualStartMs < scheduledStartMs - 60s
 * - ON_TIME: within 60s tolerance of scheduledStartMs
 * - LATE: actualStartMs > scheduledStartMs + 60s
 *
 * Duration End:
 * - Early Start: DurationEndAt = ActualStartAt + Duration
 * - On-Time:     DurationEndAt = ActualStartAt + Duration
 * - Late Start:  DurationEndAt = MIN(ActualStartAt + Duration, ScheduledEndAt)
 *
 * Max Extension / Actual End:
 * - ActualEndAt = DurationEndAt + MaxExtensionMinutes (capped at slot limits)
 */
export function calculateConsultationTiming({
  actualStartMs,
  scheduledStartMs,
  scheduledEndMs,
  durationMinutes = 10,
  maxExtensionMinutes = 10,
}) {
  const durationMs = durationMinutes * 60 * 1000;
  const maxExtensionMs = maxExtensionMinutes * 60 * 1000;
  const diffFromScheduledStart = actualStartMs - scheduledStartMs;

  let sessionStatus = 'ON_TIME';
  // 1-minute tolerance window for On-Time
  if (diffFromScheduledStart < -60 * 1000) {
    sessionStatus = 'EARLY';
  } else if (diffFromScheduledStart > 60 * 1000) {
    sessionStatus = 'LATE';
  }

  let durationEndMs;
  if (sessionStatus === 'EARLY' || sessionStatus === 'ON_TIME') {
    durationEndMs = actualStartMs + durationMs;
  } else {
    // Late Start: ends at MIN(actualStart + duration, scheduledEnd)
    durationEndMs = Math.min(actualStartMs + durationMs, scheduledEndMs);
  }

  const actualEndMs = durationEndMs + maxExtensionMs;

  return {
    sessionStatus,
    durationEndMs,
    actualEndMs,
    durationMinutes,
  };
}

