// zydoc-backend/src/application/usecases/auth/ResetPassword.js

export class ResetPassword {
    constructor(userRepository, otpService, authService) {
        this.userRepo = userRepository;
        this.otpService = otpService;
        this.authService = authService;
    }

    async execute({ userId, otp, newPassword }) {
        if (!userId || !otp || !newPassword) {
            throw new Error('UserId, OTP, and new password are required');
        }

        const user = await this.userRepo.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const isValidOtp = this.otpService.isValid(user.otp, otp);
        if (!isValidOtp) {
            throw new Error('Invalid or expired OTP');
        }

        // Hash the new password
        const hashedPassword = await this.authService.hashPassword(newPassword);

        // Update password and clear OTP
        await this.userRepo.updatePasswordAndClearOtp(userId, hashedPassword);

        return {
            success: true,
            message: "Password updated successfully"
        };
    }
}
