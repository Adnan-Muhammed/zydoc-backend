export class GetUserProfile {
    constructor(userRepository) {
        this.userRepository = userRepository;
    }

    async execute(userId) {
        const user = await this.userRepository.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }
        if (user.isDeleted) {
            throw new Error('Your account has been deactivated');
        }
        return user;
    }
}
