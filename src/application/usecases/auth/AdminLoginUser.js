export class AdminLoginUser {
    constructor(userRepository, authService) {
        this.userRepository = userRepository;
        this.authService = authService;
    }

    async execute({ email, password }) {
        const user = await this.userRepository.findByEmail(email);

        // Generic error message for security
        const errorMsg = 'Invalid admin credentials';

        if (!user) {
            throw new Error(errorMsg);
        }

        if (user.role !== 'admin') {
            // Even if password is correct, non-admins cannot log in here
            throw new Error(errorMsg);
        }

        const isPasswordValid = await this.authService.comparePassword(password, user.password);
        if (!isPasswordValid) {
            throw new Error(errorMsg);
        }

        const accessToken = this.authService.generateAccessToken(user);
        const refreshToken = this.authService.generateRefreshToken(user);

        const requires2FA = true;
        user.refreshToken = refreshToken;
        user.lastLogin = new Date();
        await this.userRepository.update(user);

        return { user, accessToken, refreshToken, requires2FA };
    }
}
