/**
 * OfflineNoShowCron.js
 *
 * Runs once daily at 23:59 to bulk-mark all unverified offline/physical
 * appointments for TODAY as 'no-show'.
 *
 * This is the authoritative no-show mechanism for in-person appointments.
 * Online appointments are handled by lazyUpdateNoShows() in the repository.
 */
import cron from 'node-cron';
import Appointment from '../database/models/Appointment.js';

export function startOfflineNoShowCron() {
  // Runs at 23:59 every day
  cron.schedule('59 23 * * *', async () => {
    console.log('[OfflineNoShowCron] Running daily offline no-show sweep at 23:59...');
    try {
      const now = new Date();

      // Build UTC bounds for the current calendar day (midnight → 23:59:59.999)
      const startOfToday = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      );
      const endOfToday = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
      );

      const result = await Appointment.updateMany(
        {
          consultationType: { $in: ['offline', 'physical'] },
          status: 'scheduled',
          // Only appointments whose date falls within today UTC
          appointmentDate: { $gte: startOfToday, $lte: endOfToday },
          // Ensure the OTP was never verified (i.e., the patient never showed up)
          offlineOTPVerifiedAt: { $exists: false },
        },
        {
          $set: { status: 'no-show' },
        }
      );

      if (result.modifiedCount > 0) {
        console.log(`[OfflineNoShowCron] Marked ${result.modifiedCount} offline appointment(s) as no-show.`);
      } else {
        console.log('[OfflineNoShowCron] No offline appointments required no-show update.');
      }
    } catch (err) {
      console.error('[OfflineNoShowCron] Error during offline no-show sweep:', err);
    }
  });

  console.log('[OfflineNoShowCron] Midnight offline no-show cron registered (runs at 23:59 daily).');
}
