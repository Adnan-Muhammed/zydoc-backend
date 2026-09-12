// src/infrastructure/utils/scheduleValidator.js

export const timeToMins = (timeStr) => {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

export const isValidGridAlignment = (timeInMins, slotDuration) => {
    return timeInMins % slotDuration === 0;
};

/**
 * Validates doctor's weekly working hours according to strict scheduling rules:
 * 1. Strict Grid Alignment: Shift start & end times must be multiples of slotDuration.
 * 2. Mixed Shifts: Online and Offline shifts can overlap (partial or full).
 * 3. Shifts of the same type cannot overlap.
 * 4. Inter-shift gaps must align with the slotDuration grid.
 * 
 * @param {Object} workingHours - { online: { monday: [...], ... }, offline: { monday: [...], ... } }
 * @param {number} slotDuration - Consultation slot duration in minutes (e.g. 15, 20, 30)
 */
export function validateWorkingHours(workingHours, slotDuration = 15) {
    if (!workingHours) return;

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    for (const day of days) {
        const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
        const onlineBlocks = Array.isArray(workingHours?.online?.[day]) 
            ? workingHours.online[day] 
            : (workingHours?.online?.[day]?.active ? [workingHours.online[day]] : []);
        const offlineBlocks = Array.isArray(workingHours?.offline?.[day]) 
            ? workingHours.offline[day] 
            : (workingHours?.offline?.[day]?.active ? [workingHours.offline[day]] : []);

        const parseBlock = (b, type) => {
            const startStr = b.start || b.startTime;
            const endStr = b.end || b.endTime;
            return {
                ...b,
                type,
                startStr,
                endStr,
                startMins: timeToMins(startStr),
                endMins: timeToMins(endStr),
                slotDuration
            };
        };

        const allShifts = [
            ...onlineBlocks.filter(b => b && (b.start || b.startTime) && (b.end || b.endTime)).map(b => parseBlock(b, 'online')),
            ...offlineBlocks.filter(b => b && (b.start || b.startTime) && (b.end || b.endTime)).map(b => parseBlock(b, 'offline'))
        ].sort((a, b) => a.startMins - b.startMins || a.endMins - b.endMins);

        if (allShifts.length === 0) continue;

        for (let i = 0; i < allShifts.length; i++) {
            const current = allShifts[i];
            const channelLabel = current.type === 'online' ? 'Telehealth' : 'In-Person';

            // 1. Valid shift boundary checks
            if (current.endMins <= current.startMins) {
                throw new Error(`${dayLabel} (${channelLabel}): Shift end time (${current.endStr}) must be after start time (${current.startStr}).`);
            }

            // 2. Absolute 5-Minute Rule (start and end must be multiples of 5 mins)
            if (current.startMins % 5 !== 0 || current.endMins % 5 !== 0) {
                throw new Error(`${dayLabel} (${channelLabel}): Shift times (${current.startStr} - ${current.endStr}) must be in 5-minute increments.`);
            }

            const duration = current.endMins - current.startMins;
            if (duration < slotDuration) {
                throw new Error(`${dayLabel} (${channelLabel}): Shift duration (${duration} mins) must be at least ${slotDuration} minutes.`);
            }

            // 3. Total Duration Remainder Rule (duration must be an exact multiple of slotDuration)
            if (duration % slotDuration !== 0) {
                throw new Error(`Shift duration on ${dayLabel} (${channelLabel}) must be an exact multiple of the slot duration (${slotDuration} mins).`);
            }

            // 4. Overlap Check with other shifts on the same day (Inter-shift gaps are free)
            for (let j = i + 1; j < allShifts.length; j++) {
                const next = allShifts[j];
                const isOverlapping = current.endMins > next.startMins;

                if (isOverlapping) {
                    if (current.type !== next.type) {
                        // Mixed shift (Online & Offline overlapping)
                        if (current.slotDuration !== next.slotDuration) {
                            throw new Error(`Slot durations must match for overlapping shifts on ${dayLabel}.`);
                        }

                        // Relative Grid Alignment Check
                        const startDiff = Math.abs(current.startMins - next.startMins);
                        if (startDiff % slotDuration !== 0) {
                            const currentLabel = current.type === 'online' ? 'Telehealth' : 'In-Person';
                            const nextLabel = next.type === 'online' ? 'Telehealth' : 'In-Person';
                            throw new Error(`Overlapping shifts on ${dayLabel} must align with the exact same slot grid. The start time of the overlapping ${nextLabel} shift (${next.startStr}) is misaligned with the ${currentLabel} shift (${current.startStr}).`);
                        }
                    } else {
                        // Same type overlap
                        throw new Error(`Conflicting ${channelLabel} shifts on ${dayLabel} (${current.startStr} - ${current.endStr}) and (${next.startStr} - ${next.endStr}). Shifts of the same type cannot overlap.`);
                    }
                }
            }
        }
    }
}

/**
 * Express Middleware helper to validate schedule payload
 */
export const validateScheduleMiddleware = (req, res, next) => {
    try {
        const workingHours = req.body.workingHours || req.body.schedule;
        const slotDuration = Number(req.body.slotDuration) || 15;
        validateWorkingHours(workingHours, slotDuration);
        next();
    } catch (err) {
        return res.status(400).json({
            success: false,
            message: err.message || 'Invalid schedule configuration'
        });
    }
};
