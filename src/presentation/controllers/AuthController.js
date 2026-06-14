// zydoc-backend/src/interface_adapters/controllers/AuthController.js

export class AuthController {
  constructor(
    signupUser,
    loginUser, 
    adminLoginUser,
    refreshToken,
    logoutUser,
    getUserProfile,
    verifyOtpUseCase,
    resendOtpUseCase,
  ) {
    this.signupUser = signupUser;
    this.loginUser = loginUser;
    this.adminLoginUser = adminLoginUser;
    this.refreshToken = refreshToken;
    this.logoutUser = logoutUser;
    this.getUserProfile = getUserProfile;
    this.verifyOtpUseCase = verifyOtpUseCase; // <--- Assigned here
    this.resendOtpUseCase = resendOtpUseCase; // 2. ADD THIS LINE
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
      isProfileCompleted: user.isProfileCompleted || false,
      verificationStatus: user.verificationStatus || 'pending',
      isDeleted: user.isDeleted,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLogin: user.lastLogin,
    };
  }

  // ✅ SIGNUP
  async signup(req, res) {
    try {
      const result = await this.signupUser.execute(req.body);
      console.log("result  signup : ", result);

      // Tokens and cookies will be set during OTP verification
      res.status(201).json(result);
    } catch (error) {
      if (error.message === "User already exists") {
        return res.status(409).json({ success: false, message: error.message });
      }

      res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }

  // Inside AuthController.js
  async verifyOtp(req, res) {
    try {
      const { email, otpCode } = req.body;
      const { user, accessToken, refreshToken } =
        await this.verifyOtpUseCase.execute({ email, otpCode });

      // Set cookies exactly like your login method
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
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(200).json({
        success: true,
        message: "Account verified and logged in",
        user: this._mapUserResponse(user),
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async resendOtp(req, res) {
    try {
      console.log("resend controller", req.body);

      const { email } = req.body;
      const result = await this.resendOtpUseCase.execute(email);
      res.status(200).json(
        result,
        // ,{ success: true, message: "OTP resent successfully" }
      );
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // ✅ LOGIN (MOST IMPORTANT)
  async login(req, res) {
    try {
      const { user, accessToken, refreshToken } = await this.loginUser.execute(
        req.body,
      );

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
        accessToken,
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
    try {
      const token = req.cookies.refreshToken;

      const { accessToken, user } = await this.refreshToken.execute(token);

      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 2 * 60 * 1000,
      });

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
