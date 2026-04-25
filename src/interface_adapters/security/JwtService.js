import jwt from 'jsonwebtoken';

export class JwtService {
    generateAccessToken(user) {
        return jwt.sign(
            { id: user.id || user._id, role: user.role, name: user.name },
            process.env.JWT_SECRET || 'access_secret',
            { expiresIn: process.env.ACCESS_TOKEN_EXPIRE || '3m' }
        );
    }

    generateRefreshToken(user) {
        return jwt.sign(
            { id: user.id || user._id, role: user.role, type: 'refresh' },
            process.env.REFRESH_SECRET || 'refresh_secret',
            { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '5m' }
        );
    }

    verifyRefreshToken(token) {
        try {
            return jwt.verify(token, process.env.REFRESH_SECRET || 'refresh_secret');
        } catch (e) {
            console.error('JwtService Verify Error:', e.message); // DEBUG
            return null;
        }
    }
}
