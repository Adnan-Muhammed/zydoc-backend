export class DeleteUser {
    constructor(userRepository) {
        this.userRepository = userRepository;
    }

    async execute({ id, adminId, hardDelete = false }) {
        const user = await this.userRepository.findById(id);

        if (!user) {
            throw new Error('User not found');
        }

        if (user.id.toString() === adminId) {
            throw new Error(hardDelete ? 'Cannot delete your own account' : 'Cannot deactivate your own account');
        }

        if (hardDelete) {
            await this.userRepository.delete(id);
        } else {
            user.isDeleted = true;
            await this.userRepository.update(user);
        }
    }
}
