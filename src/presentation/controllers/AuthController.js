// export class AuthController {
//     constructor(signupUser, loginUser, adminLoginUser, refreshToken, logoutUser, getUserProfile) {
//         this.signupUser = signupUser;
//         this.loginUser = loginUser;
//         this.adminLoginUser = adminLoginUser;
//         this.refreshToken = refreshToken;
//         this.logoutUser = logoutUser;
//         this.getUserProfile = getUserProfile;
//     }

//     async getCurrentUser(req, res) {
//         try {
//             const userId = req.user.id;
//             const user = await this.getUserProfile.execute(userId);
//             res.status(200).json({
//                 success: true,
//                 user: this._mapUserResponse(user)
//             });
//         } catch (error) {
//             res.status(404).json({ success: false, message: error.message });
//         }
//     }

//     // Helper to standardize user response
//     _mapUserResponse(user) {
//         return {
//             _id: user.id || user._id,
//             name: user.name,
//             email: user.email,
//             role: user.role,
//             isDeleted: user.isDeleted,
//             createdAt: user.createdAt,
//             updatedAt: user.updatedAt,
//             lastLogin: user.lastLogin
//         };
//     }

//     async signup(req, res) {
//         try {
//             const { user, accessToken, refreshToken } = await this.signupUser.execute(req.body);

//             res.cookie("refreshToken", refreshToken, {
//                 httpOnly: true,
//                 secure: process.env.NODE_ENV === "production",
//                 sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
//                 maxAge: 5 * 60 * 1000,
//             });

//             res.status(201).json({
//                 success: true,
//                 message: "Signup successful",
//                 user: this._mapUserResponse(user),
//                 accessToken
//             });
//         } catch (error) {
//             if (error.message === 'User already exists') {
//                 return res.status(409).json({ success: false, message: error.message });
//             }
//             res.status(400).json({ success: false, message: error.message });
//         }
//     }

//     async login(req, res) {
//         try {
//             const { user, accessToken, refreshToken } = await this.loginUser.execute(req.body);

//             res.cookie("refreshToken", refreshToken, {
//                 httpOnly: true,
//                 secure: process.env.NODE_ENV === "production",
//                 sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
//                 maxAge: 5 * 60 * 1000,
//             });

//             res.status(200).json({
//                 success: true,
//                 message: "Login successful",
//                 user: this._mapUserResponse(user),
//                 accessToken
//             });
//         } catch (error) {
//             if (error.message === 'Invalid email or password') {
//                 return res.status(401).json({ success: false, message: error.message });
//             }
//             res.status(500).json({ success: false, message: error.message });
//         }
//     }

//     async adminLogin(req, res) {
//         try {
//             console.log(1111);

//             const { user, accessToken, refreshToken } = await this.adminLoginUser.execute(req.body);

//             res.cookie("refreshToken", refreshToken, {
//                 httpOnly: true,
//                 secure: process.env.NODE_ENV === "production",
//                 sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
//                 maxAge: 5 * 60 * 1000,
//             });

//             res.status(200).json({
//                 success: true,
//                 message: "Admin login successful",
//                 user: this._mapUserResponse(user),
//                 accessToken
//             });
//         } catch (error) {
//             if (error.message === 'Invalid admin credentials') {
//                 return res.status(401).json({ success: false, message: error.message });
//             }
//             res.status(500).json({ success: false, message: error.message });
//         }
//     }

//     async refresh(req, res) {
//         try {
//             const token = req.cookies.refreshToken;
//             const { accessToken, user } = await this.refreshToken.execute(token);

//             res.json({ success: true, accessToken, user: this._mapUserResponse(user) });
//         } catch (error) {
//             res.status(403).json({ success: false, message: error.message });
//         }
//     }

//     async logout(req, res) {
//         try {
//             const token = req.cookies.refreshToken;
//             if (token) {
//                 // Minimal decode to get ID, in real app use a proper service
//                 const jwt = (await import('jsonwebtoken')).default;
//                 const decoded = jwt.decode(token);
//                 if (decoded && decoded.id) {
//                     await this.logoutUser.execute(decoded.id);
//                 }
//             }

//             res.clearCookie("refreshToken", {
//                 httpOnly: true,
//                 secure: process.env.NODE_ENV === "production",
//                 sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
//             });

//             res.status(200).json({ success: true, message: "Logged out successfully" });

//         } catch (error) {
//             res.status(500).json({ success: false, message: error.message });
//         }
//     }
// }







// zydoc-backend/src/interface_adapters/controllers/AuthController.js
export class AuthController {
    constructor(
        signupUser,
        loginUser,
        adminLoginUser,
        refreshToken,
        logoutUser,
        getUserProfile
    ) {
        this.signupUser = signupUser;
        this.loginUser = loginUser;
        this.adminLoginUser = adminLoginUser;
        this.refreshToken = refreshToken;
        this.logoutUser = logoutUser;
        this.getUserProfile = getUserProfile;
    }

    // ✅ GET CURRENT USER
    async getCurrentUser(req, res) {
        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }
            const user = await this.getUserProfile.execute(userId);

            res.status(200).json({
                success: true,
                user: this._mapUserResponse(user),
            });
        } catch (error) {
            res.status(401).json({
                success: false,
                message: error.message,
            });
        }
    }

    // ✅ HELPER
    _mapUserResponse(user) {
        return {
            _id: user.id || user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            isDeleted: user.isDeleted,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            lastLogin: user.lastLogin,
        };
    }

    // ✅ SIGNUP
    async signup(req, res) {


        try {
            const { user, accessToken, refreshToken } =
                await this.signupUser.execute(req.body);

            // ✅ COOKIE FIX
            res.cookie("accessToken", accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/", // ✅ IMPORTANT
                maxAge: 2 * 60 * 1000,
            });

            res.cookie("refreshToken", refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/", // ✅ IMPORTANT
                maxAge: 5 * 60 * 1000,
            });

            res.status(201).json({
                success: true,
                message: "Signup successful",
                user: this._mapUserResponse(user),
            });
        } catch (error) {
            if (error.message === "User already exists") {
                return res
                    .status(409)
                    .json({ success: false, message: error.message });
            }

            res.status(400).json({
                success: false,
                message: error.message,
            });
        }
    }

    // ✅ LOGIN (MOST IMPORTANT)
    async login(req, res) {
        try {
            const { user, accessToken, refreshToken } =
                await this.loginUser.execute(req.body);

            // 🔥 ACCESS TOKEN COOKIE
            res.cookie("accessToken", accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/", // ✅ REQUIRED
                maxAge: 2 * 60 * 1000, // 2 min
            });

            // 🔥 REFRESH TOKEN COOKIE
            res.cookie("refreshToken", refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/", // ✅ REQUIRED
                maxAge: 5 * 60 * 1000, // 7 days
            });

            res.status(200).json({
                success: true,
                message: "Login successful",

                user: this._mapUserResponse(user),
            });
        } catch (error) {
            if (error.message === "Invalid email or password") {
                return res.status(401).json({
                    success: false,
                    message: error.message,
                });
            }

            res.status(500).json({
                success: false,
                message: error.message,
            });
        }
    }

    // ✅ ADMIN LOGIN
    async adminLogin(req, res) {
        try {
            const { user, accessToken, refreshToken, requires2FA } =
                await this.adminLoginUser.execute(req.body);

            res.cookie("accessToken", accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 2 * 60 * 1000,
            });

            res.cookie("refreshToken", refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 5 * 60 * 1000,
            });

            res.status(200).json({
                success: true,
                message: "Admin login successful",
                requires2FA, // just try

                user: this._mapUserResponse(user),
            });
        } catch (error) {
            if (error.message === "Invalid admin credentials") {
                return res.status(401).json({
                    success: false,
                    message: error.message,
                });
            }

            res.status(500).json({
                success: false,
                message: error.message,
            });
        }
    }

    // ✅ REFRESH TOKEN
    async refresh(req, res) {
        console.log(1234567);
        console.log(1234567);
        console.log('access token is  expired so trying to refresh ');
        console.log(1234567);
        console.log(1234567);


        try {
            const token = req.cookies.refreshToken;
            console.log("COOKIES RECEIVED:", req.cookies);
            console.log("COOKIES Token refreshhhh:", token);
            console.log("COOKIES RECEIVED:", req.cookies);

            console.log(token, "refreshToken");

            const { accessToken, user } =
                await this.refreshToken.execute(token);
            console.log(accessToken, "refreshed accessToken");


            console.log(accessToken, user, 4444545454545)
            res.cookie("accessToken", accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                maxAge: 2 * 60 * 1000,
            });
            console.log("COOKIE SET SENT TO BROWSER");
            console.log("COOKIE SET SENT TO BROWSER");
            console.log("COOKIE SET SENT TO BROWSER");
            console.log(1234567890);

            res.json({
                success: true,
                user: this._mapUserResponse(user),
            });
        } catch (error) {
            res.status(403).json({
                success: false,
                message: error.message,
            });
        }
    }

    // ✅ LOGOUT
    async logout(req, res) {
        try {
            res.clearCookie("accessToken", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
            });

            res.clearCookie("refreshToken", {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
            });

            res.status(200).json({
                success: true,
                message: "Logged out successfully",
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                message: error.message,
            });
        }
    }
}