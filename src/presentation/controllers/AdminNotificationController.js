// src/presentation/controllers/AdminNotificationController.js

import Notification from '../../infrastructure/database/models/Notification.js';
import Doctor from '../../infrastructure/database/models/DoctorProfile.js';
import RefundTicket from '../../infrastructure/database/models/RefundTicket.js';

export class AdminNotificationController {
  // ── GET /api/admin/notifications ───────────────────────────────────────────
  async getNotifications(req, res) {
    try {
      // 1. Fetch system notifications & cron alerts from DB
      const dbNotifications = await Notification.find({
        $or: [{ recipientModel: 'Admin' }, { type: 'SYSTEM' }],
      })
        .sort({ createdAt: -1 })
        .limit(25)
        .lean();

      // 2. Fetch real-time operational counts for dynamic alerts
      const [pendingDoctorsCount, pendingRefundsCount] = await Promise.all([
        Doctor.countDocuments({ verificationStatus: 'pending' }),
        RefundTicket.countDocuments({ status: 'PENDING' }),
      ]);

      const alerts = [];

      // Add high-priority operational approval alert if doctors are waiting
      if (pendingDoctorsCount > 0) {
        alerts.push({
          _id: 'alert-pending-doctors',
          type: 'APPROVAL_PENDING',
          title: 'Doctor Verifications Waiting',
          message: `${pendingDoctorsCount} doctor application(s) require credential inspection and approval.`,
          link: '/admin/approvals',
          count: pendingDoctorsCount,
          isRead: false,
          createdAt: new Date(),
          priority: 'high',
        });
      }

      // Add high-priority refund alert if offline disputes are pending
      if (pendingRefundsCount > 0) {
        alerts.push({
          _id: 'alert-pending-refunds',
          type: 'REFUND_PENDING',
          title: 'Unresolved Refund Tickets',
          message: `${pendingRefundsCount} offline consultation refund ticket(s) are pending administrative review.`,
          link: '/admin/refunds',
          count: pendingRefundsCount,
          isRead: false,
          createdAt: new Date(),
          priority: 'high',
        });
      }

      // Combine with DB system notifications
      const formattedDbNotifications = dbNotifications.map((n) => ({
        _id: n._id.toString(),
        type: n.type || 'SYSTEM',
        title: n.title,
        message: n.message,
        link: n.title.includes('Online')
          ? '/admin/appointments'
          : n.title.includes('Offline')
          ? '/admin/appointments'
          : '/admin/dashboard',
        isRead: n.isRead,
        createdAt: n.createdAt,
        priority: 'normal',
      }));

      const allNotifications = [...alerts, ...formattedDbNotifications];
      const unreadCount = allNotifications.filter((item) => !item.isRead).length;

      return res.status(200).json({
        success: true,
        unreadCount,
        notifications: allNotifications,
      });
    } catch (error) {
      console.error('[AdminNotificationController] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch admin notifications',
        error: error.message,
      });
    }
  }

  // ── PATCH /api/admin/notifications/:id/read ────────────────────────────────
  async markAsRead(req, res) {
    try {
      const { id } = req.params;
      if (!id.startsWith('alert-')) {
        await Notification.findByIdAndUpdate(id, { isRead: true });
      }

      return res.status(200).json({
        success: true,
        message: 'Notification marked as read',
      });
    } catch (error) {
      console.error('[markAsRead] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to mark notification as read',
      });
    }
  }

  // ── PATCH /api/admin/notifications/read-all ─────────────────────────────────
  async markAllAsRead(req, res) {
    try {
      await Notification.updateMany(
        { $or: [{ recipientModel: 'Admin' }, { type: 'SYSTEM' }] },
        { $set: { isRead: true } }
      );

      return res.status(200).json({
        success: true,
        message: 'All notifications marked as read',
      });
    } catch (error) {
      console.error('[markAllAsRead] Error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to mark all notifications as read',
      });
    }
  }
}
