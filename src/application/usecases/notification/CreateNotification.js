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
        this.socketService.emitToUser(
          notification.recipientId.toString(),
          'new_notification',
          notification
        );
      }
    }
    
    return notification;
  }
}

export default CreateNotification;
