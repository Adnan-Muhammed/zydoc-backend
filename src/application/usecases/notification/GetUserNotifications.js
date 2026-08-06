class GetUserNotifications {
  constructor(notificationRepository) {
    this.notificationRepository = notificationRepository;
  }

  async execute(userId) {
    if (!userId) {
      throw new Error('User ID is required to fetch notifications');
    }
    return await this.notificationRepository.getByUserId(userId);
  }
}

export default GetUserNotifications;
