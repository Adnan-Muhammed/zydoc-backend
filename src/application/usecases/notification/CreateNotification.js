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
    // Avoid duplicate booking notifications for the same reference and recipient
    if (notificationData.referenceId && notificationData.type === 'BOOKING') {
      try {
        const query = {
          recipientId: notificationData.recipientId,
          referenceId: notificationData.referenceId,
          type: 'BOOKING'
        };
        const existing = typeof this.notificationRepository.findOne === 'function'
          ? await this.notificationRepository.findOne(query)
          : await Notification.findOne(query);
        if (existing) {
          console.log(`[CreateNotification] Duplicate booking notification prevented for referenceId: ${notificationData.referenceId}`);
          return existing;
        }
      } catch (dupErr) {
        console.error('[CreateNotification] Error checking duplicate notification:', dupErr);
      }
    }

    const notification = await this.notificationRepository.create(notificationData);
    
    if (this.socketService) {
      if (notification.recipientModel === 'Admin' && this.socketService.emitToRoom) {
        this.socketService.emitToRoom('admin_room', 'new_notification', notification);
      } else if (this.socketService.emitToUser) {
        let socketUserId = notification.recipientId.toString();
        let doctorSharedUserId = null;

        // For Doctor recipients, recipientId is the DoctorProfile._id.
        // Also resolve the doctor's SharedUser._id so we can detect online status
        // whether the socket is registered under DoctorProfile ID or SharedUser ID.
        if (notification.recipientModel === 'Doctor') {
          try {
            const doctorUser = await SharedUser.findOne({ profileId: notification.recipientId, role: 'doctor' }).select('_id');
            if (doctorUser) {
              doctorSharedUserId = doctorUser._id.toString();
            }
          } catch (err) {
            console.error('[CreateNotification] Error resolving doctor SharedUser:', err);
          }
        }

        const isOnline = this.socketService.isUserOnline(socketUserId) ||
          (doctorSharedUserId && this.socketService.isUserOnline(doctorSharedUserId));

        // For Doctor recipients: Check for FCM token first
        // If FCM token exists, FCM automatically routes to foreground (onMessage) when online
        // and background (Push Notification) when offline/closed.
        if (notification.recipientModel === 'Doctor') {
          try {
            const doctorProfile = await Doctor.findById(notification.recipientId).select("fcmToken");
            if (doctorProfile && doctorProfile.fcmToken) {
              await fcmService.sendToDevice(
                doctorProfile.fcmToken,
                {
                  title: notification.title,
                  body: notification.message,
                },
                {
                  notificationId: String(notification._id),
                  type: notification.type,
                  link: "/doctor/appointments",
                  referenceId: String(notification.referenceId || "")
                }
              );
              console.log(`[CreateNotification] FCM successfully sent to Doctor ${notification.recipientId} (handles onMessage in foreground / push in background)`);
            } else if (isOnline) {
              // Fallback to Socket.io if doctor has no FCM token yet
              console.log(`[CreateNotification] Doctor ${socketUserId} has no FCM token; falling back to Socket.io delivery.`);
              if (this.socketService.users && this.socketService.io) {
                const emittedSocketIds = new Set();
                const emitUnique = (id) => {
                  if (!id) return;
                  const sockets = this.socketService.users.get(id.toString());
                  if (sockets) {
                    for (const socketId of sockets) {
                      if (!emittedSocketIds.has(socketId)) {
                        emittedSocketIds.add(socketId);
                        this.socketService.io.to(socketId).emit('new_notification', notification);
                      }
                    }
                  }
                };
                emitUnique(socketUserId);
                if (doctorSharedUserId && doctorSharedUserId !== socketUserId) {
                  emitUnique(doctorSharedUserId);
                }
              } else {
                this.socketService.emitToUser(socketUserId, 'new_notification', notification);
              }
            }
          } catch (fcmError) {
            console.error("[CreateNotification] FCM Push failed:", fcmError.message);
            if (isOnline) {
              this.socketService.emitToUser(socketUserId, 'new_notification', notification);
            }
          }
        } else {
          // Non-doctor recipients (Patient, etc.)
          if (isOnline) {
            this.socketService.emitToUser(socketUserId, 'new_notification', notification);
          }
        }
      }
    }
    
    return notification;
  }
}

export default CreateNotification;
