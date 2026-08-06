class MarkAllNotificationsAsRead {
  constructor(notificationRepository) {
    this.notificationRepository = notificationRepository;
  }

  async execute(userId) {
    if (!userId) {
      throw new Error('User ID is required');
    }
    return await this.notificationRepository.markAllAsRead(userId);
  }
}

export default MarkAllNotificationsAsRead;
