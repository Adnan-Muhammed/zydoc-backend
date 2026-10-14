// zydoc-backend/src/application/usecases/auth/ForgotPassword.js
import { EMAIL_FEATURES } from '../../../infrastructure/services/EmailService.js';

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

        const userRole = user.role || 'patient';

        // SEND THE EMAIL (Centralized via emailService; redirected to admin if false)
        if (this.mailService && (typeof this.mailService.sendForgotPasswordOtpEmail === 'function' || typeof this.mailService.sendOtpEmail === 'function')) {
            try {
                if (typeof this.mailService.sendForgotPasswordOtpEmail === 'function') {
                    await this.mailService.sendForgotPasswordOtpEmail({ email, otp: code, role: userRole });
                } else {
                    await this.mailService.sendOtpEmail(email, code, 'FORGOT_PASSWORD_OTP', userRole);
                }
            } catch (error) {
                console.error("[ForgotPassword] Email delivery failed:", error?.message || error);
                if (EMAIL_FEATURES.FORGOT_PASSWORD_OTP) {
                    throw new Error('Failed to send OTP email');
                }
            }
        }

        const isOtpConfigDisabled = !EMAIL_FEATURES.FORGOT_PASSWORD_OTP;

        return {
            ...(isOtpConfigDisabled ? { otp: code, code } : {}),
            success: true,
            message: "OTP sent to your email",
            userId: user.id || user._id
        };
    }
}
