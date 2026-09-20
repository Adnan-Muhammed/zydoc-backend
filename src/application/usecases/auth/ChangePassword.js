// zydoc-backend/src/application/usecases/auth/ChangePassword.js

export class ChangePassword {
    constructor(userRepository, authService) {
        this.userRepo = userRepository;
        this.authService = authService;
    }

    async execute(userId, currentPassword, newPassword) {
        if (!userId || !newPassword) {
            throw new Error('UserId and new password are required');
        }

        const user = await this.userRepo.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // If the user has an existing password, verify the current password
        if (user.password) {
            if (!currentPassword) {
                throw new Error('Current password is required to change password');
            }
            const isPasswordValid = await this.authService.comparePassword(currentPassword, user.password);
            if (!isPasswordValid) {
                throw new Error('Incorrect current password');
            }
        }

        // Hash the new password
        const hashedPassword = await this.authService.hashPassword(newPassword);

        // Update password and clear OTP if any
        await this.userRepo.updatePasswordAndClearOtp(userId, hashedPassword);

        return {
            success: true,
            message: "Password changed successfully"
        };
    }
}
