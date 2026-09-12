# Frontend Schedule Validation Logic (frontend-schedule-logic.md)

## Objective
Provide pure JavaScript/TypeScript utility functions to validate doctor schedules before submission, leveraging the existing UI/UX for error display and rounding suggestions.

## Core Time Utility
To make calculations easy, all "HH:mm" times should be converted to minutes from midnight.
```javascript
export const timeToMinutes = (timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};



export const isValidGridAlignment = (timeInMins, slotDuration) => {
  return timeInMins % slotDuration === 0;
};
// Use this to trigger the UI prompt suggesting the nearest valid round-up/round-down time.



export const validateDailyShifts = (onlineShifts, offlineShifts) => {
  let errors = [];

  // Combine and sort all shifts by start time
  const allShifts = [
    ...onlineShifts.map(s => ({ ...s, type: 'online', startMins: timeToMinutes(s.startTime), endMins: timeToMinutes(s.endTime) })),
    ...offlineShifts.map(s => ({ ...s, type: 'offline', startMins: timeToMinutes(s.startTime), endMins: timeToMinutes(s.endTime) }))
  ].sort((a, b) => a.startMins - b.startMins);

  for (let i = 0; i < allShifts.length; i++) {
    const current = allShifts[i];

    // 1. Grid Alignment Check
    if (!isValidGridAlignment(current.startMins, current.slotDuration) || !isValidGridAlignment(current.endMins, current.slotDuration)) {
      errors.push(`Shift from ${current.startTime} to ${current.endTime} is not aligned with its ${current.slotDuration}-min duration grid.`);
    }

    // 2. Overlap & Gap Check with other shifts
    for (let j = i + 1; j < allShifts.length; j++) {
      const next = allShifts[j];
      
      const isOverlapping = current.endMins > next.startMins; // Shifts overlap
      const exactMatch = (current.startMins === next.startMins && current.endMins === next.endMins);

      if (isOverlapping) {
        if (current.type !== next.type) {
          // Mixed Shift (Online & Offline overlap) - partial/full overlaps allowed
          if (current.slotDuration !== next.slotDuration) {
             errors.push(`Overlapping shifts must have the EXACT SAME slot duration.`);
          }
        } else {
          // Same type overlap (e.g., two online shifts overlapping - logically invalid)
           errors.push(`Shifts of the same type cannot overlap.`);
        }
      } else {
        // Checking Inter-shift gaps (Rule: gap must be a multiple of the previous shift's duration)
        const gap = next.startMins - current.endMins;
        if (gap > 0 && gap % current.slotDuration !== 0) {
           errors.push(`The gap between shifts must align with the ${current.slotDuration}-min grid.`);
        }
      }
    }
  }

  return { isValid: errors.length === 0, errors };
};





// frontend-schedule-rules.md
// This file contains the core mathematical logic for validating doctor shifts in React.

export const timeToMinutes = (timeStr) => {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// Rule 1: Strict Grid Alignment
export const isValidGridAlignment = (timeInMins, slotDuration) => {
  return timeInMins % slotDuration === 0;
};

// Rule 2 & 3: Overlap & Gap Validation
export const validateDailyShifts = (onlineShifts, offlineShifts) => {
  let errors = [];
  const allShifts = [
    ...onlineShifts.map(s => ({ ...s, type: 'online', startMins: timeToMinutes(s.startTime), endMins: timeToMinutes(s.endTime) })),
    ...offlineShifts.map(s => ({ ...s, type: 'offline', startMins: timeToMinutes(s.startTime), endMins: timeToMinutes(s.endTime) }))
  ].sort((a, b) => a.startMins - b.startMins);

  for (let i = 0; i < allShifts.length; i++) {
    const current = allShifts[i];
    
    // Check Grid
    if (!isValidGridAlignment(current.startMins, current.slotDuration) || !isValidGridAlignment(current.endMins, current.slotDuration)) {
      errors.push(`Shift times must align with the ${current.slotDuration}-min grid.`);
    }

    for (let j = i + 1; j < allShifts.length; j++) {
      const next = allShifts[j];
      const isOverlapping = current.endMins > next.startMins;

      if (isOverlapping) {
        if (current.type !== next.type) {
           if (current.slotDuration !== next.slotDuration) {
             errors.push(`Overlapping shifts MUST have the exact same slot duration.`);
           }
        } else {
           errors.push(`Shifts of the same type cannot overlap.`);
        }
      } else {
        const gap = next.startMins - current.endMins;
        if (gap > 0 && gap % current.slotDuration !== 0) {
           errors.push(`The time gap between shifts must align with the ${current.slotDuration}-min grid.`);
        }
      }
    }
  }
  return { isValid: errors.length === 0, errors };
};