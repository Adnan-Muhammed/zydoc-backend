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
    async execute({ name, email, password, role }) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }


        const validRoles = ['patient', 'doctor'];
        if (!validRoles.includes(role)) {
            throw new Error('Invalid role specified');
        }

        const existingUser = await this.userRepo.findByEmail(email);
        if (existingUser) {
            throw new Error('User already exists');
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

        await this.userRepo.createWithProfile(userEntity);



        // 4. SEND THE EMAIL (The new piece)
        try {
            // await this.mailService.sendOtpEmail(email, code);
            console.log('mailService code commented');

        } catch (error) {
            // Logic Choice: You might want to log this error but still return success 
            // since the user was created in the DB and they can "Resend OTP" later.
            console.error("Email delivery failed:", error);
        }
        return { code, success: true, message: "Please verify your email" };
    }
}
