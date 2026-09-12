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
 * - 10m slot: 3m grace (7m left)
 * - 15m - 20m slot: 5m grace (10-15m left)
 * - 30m slot: 8m grace (22m left)
 * - 40m slot: 10m grace (30m left)
 * - 60m+ slot: 15m grace (45m+ left)
 */
export function getLateJoinGraceMinutes(durationMinutes = 15) {
  const dur = Number(durationMinutes) || 15;
  if (dur <= 10) return 3;
  if (dur <= 20) return 5;
  if (dur <= 30) return 8;
  if (dur <= 45) return 10;
  return 15;
}

/**
 * Returns the timestamp in milliseconds past which booking is locked/disallowed.
 * - Short slots (<= 15m): 3 minutes BEFORE slot start time.
 * - Long slots (> 15m): Allowed in-progress up until slotStart + grace period.
 */
export function getBookingCutoffMs(slotStartUTC, slotDuration = 15) {
  const startMs = slotStartUTC instanceof Date ? slotStartUTC.getTime() : new Date(slotStartUTC).getTime();
  const dur = Number(slotDuration) || 15;

  if (dur <= 15) {
    // Must be booked at least 3 minutes before slot start
    return startMs - 3 * 60 * 1000;
  }
  // In-progress booking allowed up until the late join grace period ends
  const graceMinutes = getLateJoinGraceMinutes(dur);
  return startMs + graceMinutes * 60 * 1000;
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

