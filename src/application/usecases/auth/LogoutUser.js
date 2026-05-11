export class LogoutUser {
    constructor(userRepository) {
        this.userRepository = userRepository;
    }

    async execute(userId) {
        const user = await this.userRepository.findById(userId);
        if (user) {
            user.refreshToken = null;
            await this.userRepository.update(user);
        }
    }
}
