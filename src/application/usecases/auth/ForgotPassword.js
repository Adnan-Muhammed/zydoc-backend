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

        console.log("FORGOT_PASSWORD_OTP:", code);

        // SEND THE EMAIL
        try {
            // PURPOSE: Sends OTP for forgot password verification
            // TODO: Uncomment the line below to enable actual email sending in production

            // await this.mailService.sendOtpEmail(email, code);
            console.log("TEST_LOG [Sends OTP for forgot password verification]:", { email, code });
        } catch (error) {
            console.error("Email delivery failed:", error);
            throw new Error('Failed to send OTP email');
        }

        return {
            success: true,
            message: "OTP sent to your email",
            userId: user.id || user._id
        };
    }
}
