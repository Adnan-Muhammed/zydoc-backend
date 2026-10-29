import Doctor from '../../../infrastructure/database/models/DoctorProfile.js';
import SharedUser from '../../../infrastructure/database/models/SharedUser.js';
import Notification from '../../../infrastructure/database/models/Notification.js';
import { fcmService } from '../../../infrastructure/services/FcmService.js';

class CreateNotification {
  constructor(notificationRepository, socketService) {
    this.notificationRepository = notificationRepository;
    this.socketService = socketService;
  }

  async execute(notificationData) {
    // Avoid rapid duplicate booking notifications for the same reference and recipient (< 15s window)
    if (notificationData.referenceId && notificationData.type === 'BOOKING') {
      try {
        const query = {
          recipientId: notificationData.recipientId,
          referenceId: notificationData.referenceId,
          type: 'BOOKING'
        };
        const existing = typeof this.notificationRepository.findOne === 'function'
          ? await this.notificationRepository.findOne(query)
          : await Notification.findOne(query).sort({ createdAt: -1 });

        if (existing) {
          const ageMs = Date.now() - new Date(existing.createdAt).getTime();
          if (ageMs < 15000) {
            console.log(`[CreateNotification] Rapid duplicate booking notification ignored within 15s window for referenceId: ${notificationData.referenceId}`);
            return existing;
          }
        }
      } catch (dupErr) {
        console.error('[CreateNotification] Error checking duplicate notification:', dupErr);
      }
    }

    // Persist notification to database
    const notification = await this.notificationRepository.create(notificationData);

    // Resolve doctor profile and user mappings if recipient is Doctor
    let doctorProfile = null;
    let doctorProfileId = null;
    let doctorSharedUserId = null;

    if (notification.recipientModel === 'Doctor') {
      try {
        // 1. Try finding as DoctorProfile ID
        doctorProfile = await Doctor.findById(notification.recipientId).select('fcmToken firstName lastName');
        if (doctorProfile) {
          doctorProfileId = doctorProfile._id.toString();
          const sharedUser = await SharedUser.findOne({ profileId: doctorProfile._id, role: 'doctor' }).select('_id');
          if (sharedUser) {
            doctorSharedUserId = sharedUser._id.toString();
          }
        } else {
          // 2. RecipientId might be SharedUser ID
          const sharedUser = await SharedUser.findById(notification.recipientId).select('_id profileId role');
          if (sharedUser && sharedUser.profileId) {
            doctorSharedUserId = sharedUser._id.toString();
            doctorProfile = await Doctor.findById(sharedUser.profileId).select('fcmToken firstName lastName');
            if (doctorProfile) {
              doctorProfileId = doctorProfile._id.toString();
            }
          }
        }
      } catch (err) {
        console.error('[CreateNotification] Error resolving doctor profile/user:', err);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. FCM Cloud Messaging (Primary notification engine)
    // Runs independently of socket availability to reach both online and offline doctors.
    // - Foreground: triggers onMessage in browser (toast + sound + badge update)
    // - Background / Tab Closed: triggers OS system push notification via Service Worker
    // ─────────────────────────────────────────────────────────────────────────────
    if (notification.recipientModel === 'Doctor' && doctorProfile?.fcmToken) {
      try {
        const fcmRes = await fcmService.sendToDevice(
          doctorProfile.fcmToken,
          {
            title: notification.title,
            body: notification.message,
          },
          {
            notificationId: String(notification._id),
            type: String(notification.type),
            link: "/doctor/appointments",
            referenceId: String(notification.referenceId || "")
          }
        );
        console.log(`[CreateNotification] ✅ FCM dispatch successful for Doctor ${doctorProfileId || notification.recipientId}:`, fcmRes);
      } catch (fcmErr) {
        console.error('[CreateNotification] ❌ FCM dispatch error:', fcmErr.message);
      }
    } else if (notification.recipientModel === 'Doctor') {
      console.warn(`[CreateNotification] Doctor ${doctorProfileId || notification.recipientId} has no fcmToken registered in DoctorProfile.`);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Socket.io Supplementary In-App Delivery (when socketService is provided)
    // ─────────────────────────────────────────────────────────────────────────────
    // Booking alerts are delivered through FCM for both foreground (onMessage)
    // and background (service worker push) states. Do not also emit these over
    // Socket.io, which would duplicate the doctor's in-app notification.
    if (this.socketService && !(notification.recipientModel === 'Doctor' && notification.type === 'BOOKING')) {
      try {
        if (notification.recipientModel === 'Admin' && this.socketService.emitToRoom) {
          this.socketService.emitToRoom('admin_room', 'new_notification', notification);
        } else if (notification.recipientModel === 'Doctor') {
          const targets = [doctorProfileId, doctorSharedUserId, notification.recipientId.toString()].filter(Boolean);
          const uniqueTargets = [...new Set(targets)];
          for (const targetId of uniqueTargets) {
            if (this.socketService.isUserOnline && this.socketService.isUserOnline(targetId)) {
              this.socketService.emitToUser(targetId, 'new_notification', notification);
            }
          }
        } else if (this.socketService.emitToUser) {
          const targetId = notification.recipientId.toString();
          if (!this.socketService.isUserOnline || this.socketService.isUserOnline(targetId)) {
            this.socketService.emitToUser(targetId, 'new_notification', notification);
          }
        }
      } catch (sockErr) {
        console.error('[CreateNotification] Socket emission error:', sockErr.message);
      }
    }

    return notification;
  }
}

export default CreateNotification;
