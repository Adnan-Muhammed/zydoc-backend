export class RestoreUser {
    constructor(userRepository) {
        this.userRepository = userRepository;
    }

    async execute(id) {
        const user = await this.userRepository.findById(id);

        if (!user) {
            throw new Error('User not found');
        }

        user.isDeleted = false;
        await this.userRepository.update(user);
        return user;
    }
}
