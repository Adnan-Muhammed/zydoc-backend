
// src/application/usecases/auth/LoginUser.js

export class LoginUser {
    constructor(userRepository, authService) {
        this.userRepository = userRepository;
        this.authService = authService;
    }

    async execute({ email, password }) {
        const user = await this.userRepository.findByEmail(email);
        if (!user) {
            throw new Error('Invalid email or password');
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
