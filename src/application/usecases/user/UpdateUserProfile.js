export class UpdateUserProfile {
    constructor(userRepository, authService) {
        this.userRepository = userRepository;
        this.authService = authService;
    }

    async execute({ userId, name, email, currentPassword, newPassword }) {
        const user = await this.userRepository.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }
        if (user.isDeleted) {
            throw new Error('Your account has been deactivated');
        }

        // Update name 
        if (name) {
            if (name.trim().length < 2) {
                throw new Error('Name must be at least 2 characters long');
            }
            user.name = name.trim();
        }

        // Update email
        if (email) {
            const emailExists = await this.userRepository.findByEmail(email.toLowerCase());
            if (emailExists && emailExists.id.toString() !== userId) {
                throw new Error('Email already in use');
            }
            user.email = email.toLowerCase();
        }

        // Update password
        if (newPassword) {
            if (!currentPassword) {
                throw new Error('Current password is required to set a new password');
            }

            const isPasswordValid = await this.authService.comparePassword(currentPassword, user.password);
            if (!isPasswordValid) {
                throw new Error('Current password is incorrect');
            }

            if (newPassword.length < 6) {
                throw new Error('New password must be at least 6 characters long');
            }

            user.password = await this.authService.hashPassword(newPassword);
        }

        await this.userRepository.update(user);
        return user;
    }
}
