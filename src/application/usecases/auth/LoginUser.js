
// src/application/usecases/auth/LoginUser.js

export class UnverifiedAccountError extends Error {
    constructor(message, signupToken) {
        super(message);
        this.name = 'UnverifiedAccountError';
        this.signupToken = signupToken;
    }
}

export class LoginUser {
    constructor(userRepository, authService, otpService, mailService) {
        this.userRepository = userRepository;
        this.authService = authService;
        this.otpService = otpService;
        this.mailService = mailService;
    }

    async execute({ email, password }) {
        const user = await this.userRepository.findByEmail(email);
        if (!user) {
            throw new Error('Invalid email or password');
        }

        if (!user.isVerified) {
            // Verify password first before we offer a rescue
            const isPasswordValid = await this.authService.comparePassword(password, user.password);
            if (!isPasswordValid) {
                throw new Error('Invalid email or password'); // Generic message for security
            }

            // Generate new OTP and send rescue email
            const { code, expiresAt } = this.otpService.generateOtp(10);
            user.otp = { code, expiresAt };
            await this.userRepository.update(user);
            
            // SEND THE EMAIL (Centralized via emailService; gated by EMAIL_FEATURES.LOGIN_RESCUE_OTP)
            if (this.mailService && (typeof this.mailService.sendLoginRescueOtpEmail === 'function' || typeof this.mailService.sendOtpEmail === 'function')) {
                try {
                    if (typeof this.mailService.sendLoginRescueOtpEmail === 'function') {
                        await this.mailService.sendLoginRescueOtpEmail({ email, otp: code });
                    } else {
                        await this.mailService.sendOtpEmail(email, code, 'LOGIN_RESCUE_OTP');
                    }
                } catch(e) {
                    console.error("[LoginUser] Rescue email delivery failed:", e?.message || e);
                }
            }
 
            const signupToken = this.authService.generateSignupToken(user.id || user._id);
            throw new UnverifiedAccountError('Please verify your email before logging in.', signupToken);
        }

        if (user.role === 'admin') {
            throw new Error('Invalid email or password');
        }

        if (user.isDeleted) {
            throw new Error('Your account has been deactivated');
        }

        const isPasswordValid = await this.authService.comparePassword(password, user.password);
        if (!isPasswordValid) {
            throw new Error('Invalid email or password');
        }

        const accessToken = this.authService.generateAccessToken(user);
        const refreshToken = this.authService.generateRefreshToken(user);

        user.refreshToken = refreshToken;
        user.lastLogin = new Date();
        await this.userRepository.update(user);

        return { user, accessToken, refreshToken };
    }
}
