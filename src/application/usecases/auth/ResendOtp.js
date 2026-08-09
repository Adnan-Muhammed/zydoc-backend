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

        // Send Email
        try {
            // await this.mailService.sendOtpEmail(email, code);
        } catch (error) {
            console.error("Resend OTP Mail Error:", error);
            // We don't throw here so the user can try again in 60s
        }

        console.log(code, 'otp code');

        return { code, success: true, message: "New OTP sent to your email" };
    }
}