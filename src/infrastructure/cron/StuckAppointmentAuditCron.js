// src/infrastructure/cron/StuckAppointmentAuditCron.js

import cron from 'node-cron';
import Appointment from '../database/models/Appointment.js';
import Notification from '../database/models/Notification.js';

/**
 * StuckAppointmentAuditCron
 *
 * Runs every 30 minutes to sweep for consultations that were never completed
 * or verified within 24 hours of their scheduled slot.
 *
 * 1. Offline Consultations:
 *    If an offline appointment is scheduled > 24 hours ago and the OTP was never
 *    verified, flag as 'no-show' and create an administrative alert.
 *
 * 2. Online Consultations:
 *    If an online appointment was scheduled > 24 hours ago and remained 'in_progress'
 *    or 'scheduled' without being finalized, flag as 'disputed' for admin review.
 */
export function startStuckAppointmentAuditCron() {
  // Schedule to run every 30 minutes: "*/30 * * * *"
  cron.schedule('*/30 * * * *', async () => {
    console.log('[StuckAppointmentAuditCron] Running audit sweep for stuck consultations...');
    try {
      const now = new Date();
      const cutoff24HoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // ── 1. Offline Unverified Appointments (No-Show) ────────────────────────
      const stuckOffline = await Appointment.find({
        consultationType: { $in: ['offline', 'physical'] },
        status: { $in: ['scheduled', 'pending', 'available'] },
        appointmentDate: { $lte: cutoff24HoursAgo },
        offlineOTPVerifiedAt: { $exists: false },
      }).limit(50);

      if (stuckOffline.length > 0) {
        const offlineIds = stuckOffline.map((a) => a._id);
        await Appointment.updateMany(
          { _id: { $in: offlineIds } },
          { $set: { status: 'no-show' } }
        );

        // Create Admin Notification for the batch
        await Notification.create({
          recipientModel: 'Admin',
          type: 'SYSTEM',
          title: 'Offline Appointments Flagged (No-Show)',
          message: `${stuckOffline.length} offline clinic appointment(s) exceeded the 24-hour OTP verification window and were flagged as no-show.`,
          createdAt: new Date(),
        });

        console.log(
          `[StuckAppointmentAuditCron] Flagged ${stuckOffline.length} offline appointment(s) as no-show.`
        );
      }

      // ── 2. Online Unfinalized Appointments (Disputed) ───────────────────────
      const stuckOnline = await Appointment.find({
        consultationType: { $in: ['online', 'video'] },
        status: { $in: ['scheduled', 'in_progress'] },
        appointmentDate: { $lte: cutoff24HoursAgo },
      }).limit(50);

      if (stuckOnline.length > 0) {
        const onlineIds = stuckOnline.map((a) => a._id);
        await Appointment.updateMany(
          { _id: { $in: onlineIds } },
          { $set: { status: 'disputed' } }
        );

        // Create Admin Notification for the batch
        await Notification.create({
          recipientModel: 'Admin',
          type: 'SYSTEM',
          title: 'Unfinalized Online Consultations Flagged',
          message: `${stuckOnline.length} online consultation(s) remained uncompleted after 24 hours and have been marked as disputed for administrative review.`,
          createdAt: new Date(),
        });

        console.log(
          `[StuckAppointmentAuditCron] Flagged ${stuckOnline.length} online appointment(s) as disputed.`
        );
      }

      if (stuckOffline.length === 0 && stuckOnline.length === 0) {
        console.log('[StuckAppointmentAuditCron] Clean sweep. No stuck appointments detected.');
      }
    } catch (err) {
      console.error('[StuckAppointmentAuditCron] Error during sweep:', err.message);
    }
  });

  console.log('[StuckAppointmentAuditCron] Registered (runs every 30 minutes).');
}
