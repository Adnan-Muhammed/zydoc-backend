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
    googleLoginUser,
    setRoleUseCase,
  ) {
    this.signupUser = signupUser;
    this.loginUser = loginUser;
    this.adminLoginUser = adminLoginUser;
    this.refreshToken = refreshToken;
    this.logoutUser = logoutUser;
    this.getUserProfile = getUserProfile;
    this.verifyOtpUseCase = verifyOtpUseCase;
    this.resendOtpUseCase = resendOtpUseCase;
    this.googleLoginUser = googleLoginUser;
    this.setRoleUseCase = setRoleUseCase;
  }

  // ✅ HELPER: Map User Response
  _mapUserResponse(user) {
    const response = {
      _id: user.id || user._id,
      profileId: user.profileId,
      name: user.name,
      email: user.email,
      role: user.role,
      isProfileCompleted: user.isProfileCompleted || false,
      verificationStatus: user.verificationStatus || "pending",
      isDeleted: user.isDeleted,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLogin: user.lastLogin,
    };

    if (user.role === "doctor") {
      response.medicalCertificateStatus = user.medicalCertificateStatus;
      response.medicalCertificateRejectionReason = user.medicalCertificateRejectionReason;
      response.governmentIdStatus = user.governmentIdStatus;
      response.governmentIdRejectionReason = user.governmentIdRejectionReason;
      response.qualifications = user.qualifications;
    }

    return response;
  }

  // ✅ HELPER: Set Auth Cookies
  _setAuthCookies(res, accessToken, refreshToken) {
    // Access Token: 2 minutes
    if (accessToken) {
      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 2 * 60 * 1000,
      });
    }

    // Refresh Token: 7 days
    if (refreshToken) {
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000, 
      });
    }
  }

  // ✅ HELPER: Clear Auth Cookies
  _clearAuthCookies(res) {
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
      res.status(401).json({ success: false, message: error.message });
    }
  }

  // ✅ SIGNUP
  async signup(req, res) {
    try {
      const result = await this.signupUser.execute(req.body);
      res.status(201).json(result);
    } catch (error) {
      if (error.message === "User already exists") {
        return res.status(409).json({ success: false, message: error.message });
      }
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // ✅ VERIFY OTP
  async verifyOtp(req, res) {
    try {
      const { email, otpCode } = req.body;
      const { user, accessToken, refreshToken } = await this.verifyOtpUseCase.execute({ email, otpCode });

      this._setAuthCookies(res, accessToken, refreshToken);

      res.status(200).json({
        success: true,
        message: "Account verified and logged in",
        user: this._mapUserResponse(user),
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // ✅ RESEND OTP
  async resendOtp(req, res) {
    try {
      const { email } = req.body;
      const result = await this.resendOtpUseCase.execute(email);
      res.status(200).json(result);
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // ✅ LOGIN
  async login(req, res) {
    try {
      const { user, accessToken, refreshToken } = await this.loginUser.execute(req.body);

      this._setAuthCookies(res, accessToken, refreshToken);

      res.status(200).json({
        success: true,
        message: "Login successful",
        user: this._mapUserResponse(user),
      });
    } catch (error) {
      if (error.name === 'UnverifiedAccountError') {
        return res.status(403).json({ 
          success: false, 
          message: error.message,
          requiresVerification: true,
          email: req.body.email,
          signupToken: error.signupToken
        });
      }

      if (
        error.message === "Invalid email or password" ||
        error.message === "Please verify your email before logging in." ||
        error.message === "Your account has been deactivated"
      ) {
        return res.status(401).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ✅ GOOGLE LOGIN
  async googleLogin(req, res) {
    try {
      const { firebaseToken, role } = req.body;
      const { user, accessToken, refreshToken } = await this.googleLoginUser.execute({ firebaseToken, role });

      this._setAuthCookies(res, accessToken, refreshToken);

      res.status(200).json({
        success: true,
        message: "Google Login successful",
        user: this._mapUserResponse(user),
        accessToken,
      });
    } catch (error) {
      res.status(401).json({ success: false, message: error.message });
    }
  } 

  // ✅ SET ROLE
  async setRole(req, res) { 
    try {
      const userId = req.user?.id || req.user?._id;
      const { role } = req.body;

      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const { user, accessToken, refreshToken } = await this.setRoleUseCase.execute(userId, role);

      this._setAuthCookies(res, accessToken, refreshToken);

      res.status(200).json({
        success: true,
        message: "Role assigned successfully",
        user: this._mapUserResponse(user),
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  // ✅ ADMIN LOGIN
  async adminLogin(req, res) {
    try {
      const { user, accessToken, refreshToken, requires2FA } = await this.adminLoginUser.execute(req.body);

      this._setAuthCookies(res, accessToken, refreshToken);

      res.status(200).json({
        accessToken,
        success: true,
        message: "Admin login successful",
        requires2FA,
        user: this._mapUserResponse(user),
      });
    } catch (error) {
      if (error.message === "Invalid admin credentials") {
        return res.status(401).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ✅ REFRESH TOKEN
  async refresh(req, res) {
    try {
      const token = req.cookies.refreshToken;
      const { accessToken, user } = await this.refreshToken.execute(token);

      this._setAuthCookies(res, accessToken, null); // Keep old refresh token in cookie

      res.json({
        success: true,
        user: this._mapUserResponse(user),
        accessToken,
      });
    } catch (error) {
      res.status(403).json({ success: false, message: error.message });
    }
  }

  // ✅ LOGOUT
  async logout(req, res) {
    try {
      this._clearAuthCookies(res);
      res.status(200).json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}
