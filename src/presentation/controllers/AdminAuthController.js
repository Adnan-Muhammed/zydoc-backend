// zydoc-backend/src/presentation/controllers/AdminAuthController.js
import jwt from "jsonwebtoken";

export class AdminAuthController {
  constructor(adminLoginUser, adminGoogleLoginUser, refreshToken, logoutUser) {
    this.adminLoginUser = adminLoginUser;
    this.adminGoogleLoginUser = adminGoogleLoginUser;
    this.refreshToken = refreshToken;
    this.logoutUser = logoutUser;
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
      approvalStatus: user.approvalStatus || user.verificationStatus || "pending",
      rejectionReason: user.rejectionReason || "",
      isDeleted: user.isDeleted,
      hasPassword: !!user.password,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLogin: user.lastLogin,
    };

    if (user.role === "admin") {
      response.isSuperAdmin = user.isSuperAdmin || false;
      response.permissions = user.permissions || [];
      response.adminRole = user.adminRole || "super_admin";
      response.department = user.department || "Management";
    }

    return response;
  }

  // ✅ HELPER: Set Auth Cookies
  _setAuthCookies(res, accessToken, refreshToken) {
    // Access Token: 15 minutes
    if (accessToken) {
      res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        domain: process.env.NODE_ENV === "production" ? ".carehealth.online" : "localhost",
        path: "/",
        maxAge: 15 * 60 * 1000,
      });
    }

    // Refresh Token: 7 days 
    if (refreshToken) {
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        domain: process.env.NODE_ENV === "production" ? ".carehealth.online" : "localhost",
        path: "/",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
    }
  }

  // ✅ HELPER: Clear Auth Cookies with exact matching options
  _clearAuthCookies(res) {
    const isProd = process.env.NODE_ENV === "production";
    const cookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      domain: isProd ? ".carehealth.online" : "localhost",
      path: "/",
    };
    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);
  }

  // ✅ ADMIN LOGIN (Email + Password)
  async adminLogin(req, res) {
    try {
      const { user, accessToken, refreshToken } = await this.adminLoginUser.execute(req.body);

      this._setAuthCookies(res, accessToken, refreshToken);

      res.status(200).json({
        accessToken,
        success: true,
        message: "Admin login successful",
        user: this._mapUserResponse(user),
      });
    } catch (error) {
      if (error.message === "Invalid admin credentials") {
        return res.status(401).json({ success: false, message: error.message });
      }
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // ✅ ADMIN GOOGLE LOGIN
  async adminGoogleLogin(req, res) {
    try {
      const { firebaseToken } = req.body;
      const { user, accessToken, refreshToken } = await this.adminGoogleLoginUser.execute({ firebaseToken });

      this._setAuthCookies(res, accessToken, refreshToken);

      res.status(200).json({
        success: true,
        message: "Admin Google Login successful",
        user: this._mapUserResponse(user),
        accessToken,
      });
    } catch (error) {
      if (error.message.includes('Unauthorized Google Account') || error.message.includes('Invalid admin account')) {
        return res.status(403).json({ success: false, message: error.message });
      }
      res.status(401).json({ success: false, message: error.message });
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
      let userId = req.user?.id || req.user?._id;

      if (!userId) {
        const token = req.cookies?.accessToken || req.cookies?.refreshToken;
        if (token) {
          try {
            const decoded = jwt.decode(token);
            userId = decoded?.id || decoded?._id || decoded?.userId;
          } catch {
            // Ignore decode failures; proceed to wipe cookies
          }
        }
      }

      if (userId && this.logoutUser) {
        await this.logoutUser.execute(userId);
      }

      this._clearAuthCookies(res);
      res.status(200).json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      this._clearAuthCookies(res);
      res.status(500).json({ success: false, message: error.message });
    }
  }
}
