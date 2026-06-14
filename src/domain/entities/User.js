
//src/domain/entities/User.js
export class User {
    constructor(id, name, email, password, role, isDeleted = false, refreshToken = null, lastLogin = null) {
        this.id = id;
        this.name = name;
        this.email = email;
        this.password = password;
        this.role = role || 'user';
        this.isDeleted = isDeleted;
        this.refreshToken = refreshToken;
        this.lastLogin = lastLogin;
        this.isVerified = false; // Default
        this.isProfileCompleted = false; // 🔥 Tracks if user completed their onboarding forms
        this.verificationStatus = 'pending'; // 🔥 Tracks if admin approved the doctor ('pending', 'approved', 'rejected')
        this.otp = { code: null, expiresAt: null };
    }

    // Domain logic validation could go here
    isValid() {
        return this.name && this.email && this.password;
    }
}