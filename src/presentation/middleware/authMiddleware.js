// src/presentation/middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import { JwtService } from "../../infrastructure/security/JwtService.js";

const jwtService = new JwtService();

/**
 * 🔒 Protect routes — requires a valid access token
 * Reads from cookie first, then Authorization header
 */
export const protect = (req, res, next) => {
    try {
        let token = req.cookies?.accessToken;

        if (!token && req.headers.authorization?.startsWith("Bearer ")) {
            const authHeader = req.headers.authorization.split(" ")[1];
            if (authHeader !== "undefined" && authHeader !== "null") {
                token = authHeader;
            }
        }

        if (!token) {
            return res.status(401).json({ message: "No token" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || "access_secret");
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: "Invalid token" });
    }
};

/**
 * 🚫 Block already-logged-in users from accessing login/signup
 */
export const redirectIfAuth = async (req, res, next) => {
    try {
        const accessToken = req.cookies?.accessToken;
        const refreshToken = req.cookies?.refreshToken;

        // No tokens → not logged in → allow through
        if (!accessToken && !refreshToken) {
            return next();
        }

        // Has valid accessToken → already logged in
        if (accessToken) {
            return res.status(403).json({
                success: false,
                message: "Already logged in",
            });
        }

        // Has refreshToken but no accessToken → check if session still valid
        if (refreshToken) {
            try {
                jwtService.verifyRefreshToken(refreshToken);
                return res.status(403).json({
                    success: false,
                    message: "Already logged in",
                });
            } catch {
                // Refresh token invalid/expired → allow through
                return next();
            }
        }

        next();
    } catch {
        next();
    }
};