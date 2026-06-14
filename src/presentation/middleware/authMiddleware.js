// import jwt from "jsonwebtoken";

// export const protect = async (req, res, next) => {
//     try {
//         let token;
//         const authHeader = req.headers.authorization;

//         if (authHeader && authHeader.startsWith("Bearer ")) {
//             token = authHeader.split(" ")[1];
//         } else if (req.cookies.accessToken) {
//             token = req.cookies.accessToken;
//         } else if (req.cookies.token) {
//             token = req.cookies.token;
//         }

//         if (!token) {
//             return res.status(401).json({
//                 success: false,
//                 message: "Not authorized. Please login first.",
//             });
//         }

//         // Verify token
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);

//         // Check if token is expired (jwt.verify handles this usually, but explicit check for custom logic)
//         const currentTime = Math.floor(Date.now() / 1000);
//         if (decoded.exp && decoded.exp < currentTime) {
//             return res.status(401).json({
//                 success: false,
//                 message: "Access token expired.",
//             });
//         }

//         // Attach user to request
//         req.user = decoded;

//         // Check database for immediate termination (account deleted/blocked)
//         const UserModel = (await import('../../database/models/UserModel.js')).default;

//         console.log('[AuthMiddleware] Verifying user status for ID:', decoded.id);
//         const user = await UserModel.findById(decoded.id).select('isDeleted');
//         console.log('[AuthMiddleware] DB Result:', user ? `Found (isDeleted: ${user.isDeleted})` : 'Not Found');

//         if (!user || user.isDeleted) {
//             return res.status(401).json({
//                 success: false,
//                 message: "Not authorized. Account deactivated or not found.",
//                 errorCode: 'ACCOUNT_DEACTIVATED'
//             });
//         }

//         console.log('Auth Middleware: passed, calling next()'); // TRACE
//         next();
//     } catch (error) {
//         if (error.name === "TokenExpiredError") {
//             return res.status(401).json({
//                 success: false,
//                 message: "Access token expired. Please refresh your token.",
//             });
//         }

//         if (error.name === "JsonWebTokenError") {
//             return res.status(401).json({
//                 success: false,
//                 message: "Invalid access token.",
//             });
//         }

//         return res.status(500).json({
//             success: false,
//             message: "Authentication failed.",
//             errorName: error.name,
//             errorMessage: error.message
//         });
//     }
// };

// /**
//  * Middleware to check if user is already authenticated.
//  * Used for routes that should NOT be accessible to logged-in users (like login/signup).
//  */
// export const redirectIfAuth = (req, res, next) => {
//     // Check for tokens in cookies
//     const token = req.cookies.accessToken || req.cookies.refreshToken || req.cookies.token;

//     if (token) {
//         console.log('[AuthMiddleware] User already has a token, blocking access to auth route.');
//         return res.status(400).json({
//             success: false,
//             message: "You are already logged in.",
//             alreadyAuthenticated: true
//         });
//     }

//     next();
// };











// import jwt from "jsonwebtoken";

// /**
//  * 🔒 Protect routes (require authentication)
//  */
// export const protect = async (req, res, next) => {
//     try {
//         let token;

//         // ✅ 1. Get token (priority: cookie → header)
//         if (req.cookies?.accessToken) {
//             token = req.cookies.accessToken;
//         } else if (req.headers.authorization?.startsWith("Bearer ")) {
//             token = req.headers.authorization.split(" ")[1];
//         }

//         // ❌ remove legacy "token" usage (avoid confusion)
//         // DO NOT use req.cookies.token anymore

//         if (!token) {
//             return res.status(401).json({
//                 success: false,
//                 message: "Not authorized. Please login first.",
//             });
//         }

//         // ✅ 2. Verify token
//         const decoded = jwt.verify(token, process.env.JWT_SECRET);

//         // ✅ 3. Attach user
//         req.user = decoded;

//         // ✅ 4. Validate user in DB
//         const UserModel = (await import('../../database/models/UserModel.js')).default;

//         const user = await UserModel.findById(decoded.id).select('isDeleted');

//         if (!user || user.isDeleted) {
//             return res.status(401).json({
//                 success: false,
//                 message: "Account deactivated or not found.",
//             });
//         }

//         next();
//     } catch (error) {
//         // ✅ Proper JWT error handling
//         if (error.name === "TokenExpiredError") {
//             return res.status(401).json({
//                 success: false,
//                 message: "Access token expired.",
//             });
//         }

//         if (error.name === "JsonWebTokenError") {
//             return res.status(401).json({
//                 success: false,
//                 message: "Invalid access token.",
//             });
//         }

//         return res.status(500).json({
//             success: false,
//             message: "Authentication failed.",
//         });
//     }
// };


// /**
//  * 🚫 Block logged-in users from accessing login/signup
//  */
// export const redirectIfAuth = (req, res, next) => {
//     // ✅ ONLY check accessToken (not refreshToken)
//     const accessToken = req.cookies?.accessToken;

//     if (accessToken) {
//         console.log('[AuthMiddleware] Already logged in');

//         return res.status(400).json({
//             success: false,
//             message: "Already logged in",
//         });
//     }

//     next();
// };





// zydoc-backend/src/frameworks_networks/web/middleware/authMiddleware.js
import jwt from "jsonwebtoken";

export const protect = (req, res, next) => {
    try {
        const token = (req.cookies?.accessToken||req.headers.authorization.split(" ")[1])

        console.log(123456);


        // //  just test in backend to backend
        // if (!token && req.headers.authorization?.startsWith("Bearer ")) {
        //     token = req.headers.authorization.split(" ")[1];
        // }
        // //  just test in backend to backend

        console.log(6666);

        if (!token) {
            return res.status(401).json({ message: "No token" });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET || "access_secret"
        );

        req.user = decoded;
        next();
    } catch (err) {

        return res.status(401).json({ message: "Invalid token" });
    }
};

// export const redirectIfAuth = (req, res, next) => {

//     // ✅ ONLY check accessToken (not refreshToken)
//     const accessToken = req.cookies?.accessToken;

//     if (accessToken) {
//         console.log('[AuthMiddleware] Already logged in');

//         return res.status(400).json({
//             success: false,
//             message: "Already logged in",
//         });
//     }

//     next();
// };






// middleware/authMiddleware.js

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
                message: 'Already logged in',
            });
        }

        // Has refreshToken but no accessToken → still a valid session
        if (refreshToken) {
            try {
                jwtService.verifyRefreshToken(refreshToken); // throws if expired
                return res.status(403).json({
                    success: false,
                    message: 'Already logged in',
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