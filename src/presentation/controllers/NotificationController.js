import GetUserNotifications from '../../application/usecases/notification/GetUserNotifications.js';
import MarkNotificationAsRead from '../../application/usecases/notification/MarkNotificationAsRead.js';
import MarkAllNotificationsAsRead from '../../application/usecases/notification/MarkAllNotificationsAsRead.js';
import SharedUser from '../../infrastructure/database/models/SharedUser.js';
import Admin from '../../infrastructure/database/models/AdminProfile.js';

class NotificationController {
  constructor(notificationRepository) {
    this.notificationRepository = notificationRepository;
  }

  async getNotifications(req, res) {
    try {
      const authId = req.user?.id || req.user?._id; 
      if (!authId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const user = await SharedUser.findById(authId);
      let userId = user?.profileId || authId;

      // For admins, unconditionally match what PaymentController uses (Admin.findOne()._id)
      if (user?.role === 'admin') {
        const adminProfile = await Admin.findOne();
        if (adminProfile) {
          userId = adminProfile._id;
        }
      }

      const useCase = new GetUserNotifications(this.notificationRepository);
      const notifications = await useCase.execute(userId);
      
      res.status(200).json({
        success: true,
        data: notifications
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async markAsRead(req, res) {
    try {
      const { id } = req.params;
      const useCase = new MarkNotificationAsRead(this.notificationRepository);
      const updatedNotification = await useCase.execute(id);

      if (!updatedNotification) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }

      res.status(200).json({
        success: true,
        data: updatedNotification
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async markAllAsRead(req, res) {
    try {
      const authId = req.user?.id || req.user?._id;
      if (!authId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const user = await SharedUser.findById(authId);
      let userId = user?.profileId || authId;

      // For admins, unconditionally match what PaymentController uses (Admin.findOne()._id)
      if (user?.role === 'admin') {
        const adminProfile = await Admin.findOne();
        if (adminProfile) {
          userId = adminProfile._id;
        }
      }

      const useCase = new MarkAllNotificationsAsRead(this.notificationRepository);
      await useCase.execute(userId);
      
      res.status(200).json({
        success: true,
        message: 'All notifications marked as read'
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
}

export default NotificationController;
