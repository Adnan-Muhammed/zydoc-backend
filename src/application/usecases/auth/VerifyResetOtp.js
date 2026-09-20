// zydoc-backend/src/application/usecases/auth/VerifyResetOtp.js

export class VerifyResetOtp {
    constructor(userRepository, otpService) {
        this.userRepo = userRepository;
        this.otpService = otpService;
    }

    async execute({ userId, otp }) {
        if (!userId || !otp) {
            throw new Error('UserId and OTP are required');
        }

        const user = await this.userRepo.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        const isValidOtp = this.otpService.isValid(user.otp, otp);
        if (!isValidOtp) {
            throw new Error('Invalid or expired OTP');
        }

        return {
            success: true,
            message: "OTP is valid"
        };
    }
}
