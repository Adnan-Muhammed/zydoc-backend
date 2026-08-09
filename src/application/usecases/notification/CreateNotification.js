import fs from 'fs';
import Doctor from '../../../infrastructure/database/models/DoctorProfile.js';
import SharedUser from '../../../infrastructure/database/models/SharedUser.js';
import { fcmService } from '../../../infrastructure/services/FcmService.js';

class CreateNotification {
  constructor(notificationRepository, socketService) {
    this.notificationRepository = notificationRepository;
    this.socketService = socketService;
  }

  async execute(notificationData) {
    const notification = await this.notificationRepository.create(notificationData);
    
    if (this.socketService) {
      if (notification.recipientModel === 'Admin' && this.socketService.emitToRoom) {
        this.socketService.emitToRoom('admin_room', 'new_notification', notification);
      } else if (this.socketService.emitToUser) {
        
        let socketUserId = notification.recipientId.toString();

        // 1. Check if user is connected to Socket.io
        // The frontend Topbar.tsx registers using profileId (which matches notification.recipientId)
        if (this.socketService.isUserOnline(socketUserId)) {
            console.log(`[CreateNotification] User ${socketUserId} is ONLINE. Using Socket.io.`);
            fs.appendFileSync('fcm_debug.log', `[${new Date().toISOString()}] ONLINE -> Socket (Notification ID: ${notification._id})\n`);
            
            // Emit to the socketUserId (DoctorProfile ID)
            this.socketService.emitToUser(socketUserId, 'new_notification', notification);
        } else {
            console.log(`[CreateNotification] User ${socketUserId} is OFFLINE. Attempting FCM Push.`);
            fs.appendFileSync('fcm_debug.log', `[${new Date().toISOString()}] OFFLINE -> FCM Push (Notification ID: ${notification._id})\n`);
            
            // 2. If offline, send FCM Push Notification (Only for Doctors right now)
            if (notification.recipientModel === 'Doctor') {
                try {
                    const doctorProfile = await Doctor.findById(notification.recipientId).select("fcmToken");
                    if (doctorProfile && doctorProfile.fcmToken) {
                      const datatest=   await fcmService.sendToDevice(
                            doctorProfile.fcmToken,
                            {
                                title: notification.title,
                                body: notification.message,
                            },
                            {
                                notificationId: String(notification._id),
                                type: notification.type,
                                link: "/doctor/appointments", // Standard doctor dashboard link
                                referenceId: String(notification.referenceId || "")
                            }
                        );

                        console.log(11111);
                        
                        console.log(datatest);
                        
                        console.log(`[CreateNotification] FCM successfully sent to Doctor ${notification.recipientId}`);
                    } else {
                        console.log(`[CreateNotification] Doctor ${notification.recipientId} has no FCM token. Notification skipped.`);
                    }
                } catch (fcmError) {
                    console.error("[CreateNotification] FCM Push failed:", fcmError.message);
                }
            }
        }
      }
    }
    
    return notification;
  }
}

export default CreateNotification;
