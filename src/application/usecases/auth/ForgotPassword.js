// zydoc-backend/src/application/usecases/auth/ForgotPassword.js

export class ForgotPassword {
    constructor(userRepository, otpService, mailService) {
        this.userRepo = userRepository;
        this.otpService = otpService;
        this.mailService = mailService;
    }

    async execute({ email }) {
        if (!email) {
            throw new Error('Email is required');
        }

        const user = await this.userRepo.findByEmail(email);
        if (!user) {
            throw new Error('Account not found. Please sign up.');
        }

        // Generate OTP
        const { code, expiresAt } = this.otpService.generateOtp(10); // 10 minutes expiry

        // Save OTP to user record
        await this.userRepo.updateOtp(user.id || user._id, code, expiresAt);

        // SEND THE EMAIL (Centralized via emailService; gated by EMAIL_FEATURES.FORGOT_PASSWORD_OTP)
        if (this.mailService && (typeof this.mailService.sendForgotPasswordOtpEmail === 'function' || typeof this.mailService.sendOtpEmail === 'function')) {
            try {
                if (typeof this.mailService.sendForgotPasswordOtpEmail === 'function') {
                    await this.mailService.sendForgotPasswordOtpEmail({ email, otp: code });
                } else {
                    await this.mailService.sendOtpEmail(email, code, 'FORGOT_PASSWORD_OTP');
                }
            } catch (error) {
                console.error("[ForgotPassword] Email delivery failed:", error?.message || error);
                throw new Error('Failed to send OTP email');
            }
        }

        return {
            success: true,
            message: "OTP sent to your email",
            userId: user.id || user._id
        };
    }
}
