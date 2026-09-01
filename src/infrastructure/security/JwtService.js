
// src/infrastructure/security/JwtService.js

import jwt from 'jsonwebtoken';

export class JwtService {
    generateAccessToken(user) {
        return jwt.sign(
            { 
                id: user.id || user._id, 
                role: user.role, 
                name: user.name,
                isProfileCompleted: user.isProfileCompleted || false,
                isVerifiedByAdmin: user.isVerifiedByAdmin || false
            },
            // this line currently 2m but i want to be 15m
            process.env.JWT_SECRET || 'access_secret',
            { expiresIn: process.env.ACCESS_TOKEN_EXPIRE || '15m' }
        );
    }

    generateRefreshToken(user) {
        return jwt.sign(
            { id: user.id || user._id, role: user.role, type: 'refresh' },
            // this line currently 5m but i want to be 7 days
            process.env.REFRESH_SECRET || 'refresh_secret',
            { expiresIn: process.env.REFRESH_TOKEN_EXPIRE || '7d' }
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

    generateSignupToken(userId) {
        return jwt.sign(
            { id: userId, type: 'signup' },
            process.env.JWT_SECRET || 'access_secret',
            { expiresIn: '15m' }
        );
    }

    verifySignupToken(token) {
        try {
            return jwt.verify(token, process.env.JWT_SECRET || 'access_secret');
        } catch (e) {
            return null;
        }
    }
}
