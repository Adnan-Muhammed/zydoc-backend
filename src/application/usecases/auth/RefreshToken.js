//  zydoc-backend/src/usecases/auth/RefreshToken.js

export class RefreshToken {
    constructor(userRepository, authService) {
        this.userRepository = userRepository;
        this.authService = authService;
    }

    async execute(refreshToken) {
        if (!refreshToken) {
            throw new Error('Refresh token is required');
        }

        const decoded = this.authService.verifyRefreshToken(refreshToken);
        if (!decoded || !decoded.id) {
            throw new Error('Invalid refresh token');
        }

        const user = await this.userRepository.findById(decoded.id);
        if (!user) {
            throw new Error('User not found');
        }

        if (user.isDeleted) {
            throw new Error('Your account has been deactivated');
        }

        if (user.refreshToken !== refreshToken) {
            throw new Error('Invalid refresh token');
        }

        const accessToken = this.authService.generateAccessToken(user);
        return { accessToken, user };
    }
}
