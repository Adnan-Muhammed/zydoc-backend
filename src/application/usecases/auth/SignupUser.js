// zydoc-backend/src/usecases/auth/SignupUser.js
import { User } from '../../../domain/entities/User.js';

export class SignupUser {

 

    // We now create two records: the Profile and the Identity.
    constructor(userRepository, authService, otpService, mailService) {
        this.userRepo = userRepository;
        this.authService = authService;
        this.otpService = otpService;
        this.mailService = mailService;

    }

    // async execute({ name, email, password, role = 'patient' }) {
    async execute({ name, email, password, role, signupToken }) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }

        const validRoles = ['patient', 'doctor'];
        if (!validRoles.includes(role)) {
            throw new Error('Invalid role specified');
        }

        // Cleanup orphaned record if user is retrying with a new email via "Change Email"
        if (signupToken) {
            const decoded = this.authService.verifySignupToken(signupToken);
            if (decoded && decoded.type === 'signup') {
                const oldUser = await this.userRepo.findById(decoded.id);
                if (oldUser && !oldUser.isVerified) {
                    await this.userRepo.delete(oldUser.id);
                }
            }
        }

        const existingUser = await this.userRepo.findByEmail(email);
        if (existingUser) {
            if (!existingUser.isVerified) {
                // Graceful recovery: Delete abandoned unverified account and proceed with fresh signup
                await this.userRepo.delete(existingUser.id);
            } else {
                throw new Error('User already exists');
            }
        }

        const { code, expiresAt } = this.otpService.generateOtp(10);

        const hashedPassword = await this.authService.hashPassword(password);

        // 2. CREATE THE DOMAIN ENTITY
        // We use the entity to ensure the data is valid before saving
        const userEntity = new User(
            null,
            name || email.split('@')[0],
            email,
            hashedPassword,
            role
        );

        userEntity.otp = { code, expiresAt };
        userEntity.isVerified = false;

        if (!userEntity.isValid()) throw new Error('Invalid user data');

        const savedUser = await this.userRepo.createWithProfile(userEntity);

        const newSignupToken = this.authService.generateSignupToken(savedUser.id || savedUser._id);

        // 4. SEND THE EMAIL
        try {
            await this.mailService.sendOtpEmail(email, code);
        } catch (error) {
            console.error("Email delivery failed:", error);
        }
        
        return { 
            code, // We can optionally remove this from payload for security if it's sent via email
            success: true, 
            message: "Please verify your email",
            signupToken: newSignupToken
        };
    }
}
