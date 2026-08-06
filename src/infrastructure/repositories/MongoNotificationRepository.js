import Notification from '../database/models/Notification.js';

class MongoNotificationRepository {
  async create(notificationData) {
    const notification = new Notification(notificationData);
    return await notification.save();
  }

  async getByUserId(userId) {
    return await Notification.find({ recipientId: userId }).sort({ createdAt: -1 });
  }

  async markAsRead(notificationId) {
    return await Notification.findByIdAndUpdate(
      notificationId,
      { isRead: true },
      { new: true }
    );
  }

  async markAllAsRead(userId) {
    return await Notification.updateMany(
      { recipientId: userId, isRead: false },
      { isRead: true }
    );
  }
}

export default MongoNotificationRepository;
