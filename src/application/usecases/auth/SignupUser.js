// zydoc-backend/src/usecases/auth/SignupUser.js
import { User } from '../../../domain/entities/User.js';

export class SignupUser {
    constructor(userRepository, authService) {
        this.userRepository = userRepository;
        this.authService = authService;
    }

    async execute({ name, email, password, role = 'patient' }) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }

        const finalName = name && name.trim() !== '' ? name : email.split('@')[0];

        const validRoles = ['patient', 'doctor'];
        if (!validRoles.includes(role)) {
            throw new Error('Invalid role specified');
        }

        const existingUser = await this.userRepository.findByEmail(email);
        if (existingUser) {
            throw new Error('User already exists');
        }

        const hashedPassword = await this.authService.hashPassword(password);

        // Create User entity
        const newUser = new User(null, finalName, email, hashedPassword, role);

        const createdUser = await this.userRepository.create(newUser);

        // Generate tokens
        const accessToken = this.authService.generateAccessToken(createdUser);
        const refreshToken = this.authService.generateRefreshToken(createdUser);

        // Update user with refresh token
        createdUser.refreshToken = refreshToken;
        createdUser.lastLogin = new Date();
        await this.userRepository.update(createdUser);

        return { user: createdUser, accessToken, refreshToken };
    }
}
