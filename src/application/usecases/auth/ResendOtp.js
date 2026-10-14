import { EMAIL_FEATURES } from '../../../infrastructure/services/EmailService.js';

export class ResendOtp {
    constructor(userRepository, otpService, mailService) {
        this.userRepo = userRepository;
        this.otpService = otpService;
        this.mailService = mailService;
    }


    async execute(email) {
        // console.log(email, "email");
        // resendotp 
        const user = await this.userRepo.findByEmail(email);

        if (!user) {
            throw new Error('User not found');
        }

        if (user.isVerified) {
            throw new Error('User is already verified');
        }

        // Generate new OTP
        const { code, expiresAt } = this.otpService.generateOtp(10);

        // Update user in DB with new OTP
        user.otp = { code, expiresAt };
        await this.userRepo.update(user);

        const userRole = user.role || 'patient';

        // SEND THE EMAIL (Centralized via emailService; redirected to admin if false)
        if (this.mailService && (typeof this.mailService.sendResendOtpEmail === 'function' || typeof this.mailService.sendOtpEmail === 'function')) {
            try {
                if (typeof this.mailService.sendResendOtpEmail === 'function') {
                    await this.mailService.sendResendOtpEmail({ email, otp: code, role: userRole });
                } else {
                    await this.mailService.sendOtpEmail(email, code, 'RESEND_OTP', userRole);
                }
            } catch (error) {
                console.error("[ResendOtp] Mail delivery error:", error?.message || error);
                // We don't throw here so the user can try again in 60s
            }
        }

        const isOtpConfigDisabled = !EMAIL_FEATURES.RESEND_OTP;

        return { 
            ...(isOtpConfigDisabled ? { otp: code, code } : {}),
            success: true, 
            message: "New OTP sent to your email" 
        };
    }
}