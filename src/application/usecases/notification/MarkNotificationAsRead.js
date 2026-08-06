class MarkNotificationAsRead {
  constructor(notificationRepository) {
    this.notificationRepository = notificationRepository;
  }

  async execute(notificationId) {
    if (!notificationId) {
      throw new Error('Notification ID is required');
    }
    return await this.notificationRepository.markAsRead(notificationId);
  }
}

export default MarkNotificationAsRead;
