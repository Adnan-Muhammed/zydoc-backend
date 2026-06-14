// src/application/usecases/auth/VerifyOtp.js
export class VerifyOtp {
    constructor(userRepository, authService, otpService) {
        this.userRepository = userRepository;
        this.authService = authService;
        this.otpService = otpService;
    }

    async execute({ email, otpCode }) {
        // 1. Find user (this will include populated profile via repo)
        const user = await this.userRepository.findByEmail(email);
        if (!user) throw new Error("User not found");

        // 2. Validate OTP
        const isValid = this.otpService.isValid(user.otp, otpCode);
        if (!isValid) throw new Error("Invalid or expired OTP");

        // 3. Mark as verified & clear OTP
        user.isVerified = true;
        user.otp = { code: null, expiresAt: null };

        // 4. Generate Session (Tokens)
        const accessToken = this.authService.generateAccessToken(user);
        const refreshToken = this.authService.generateRefreshToken(user);

        user.refreshToken = refreshToken;
        user.lastLogin = new Date();

        // 5. Save changes
        await this.userRepository.update(user);

        return { user, accessToken, refreshToken };
    }
}