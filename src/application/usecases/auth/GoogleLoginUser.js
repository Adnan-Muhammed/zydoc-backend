//  zydoc-backend/src/application/usecases/auth/GoogleLoginUser.js

import { User } from '../../../domain/entities/User.js';

export class GoogleLoginUser {
  constructor(userRepository, authService, firebaseAuth) {
    this.userRepository = userRepository;
    this.authService = authService;
    this.firebaseAuth = firebaseAuth; // Firebase admin auth instance
  } 

  async execute({ firebaseToken, role }) { 
    // 1. Verify Firebase token
    let decodedToken;
    try {
      decodedToken = await this.firebaseAuth.verifyIdToken(firebaseToken);
    } catch (error) {
      console.error("Firebase verifyIdToken error:", error);
      throw new Error('Invalid Firebase Token');
    }

    const email = decodedToken.email;
    const name = decodedToken.name || 'Google User';
    const finalRole = role || 'unassigned'; // Use requested role, default to unassigned

    // 2. Find user in MongoDB
    let user = await this.userRepository.findByEmail(email);

    if (!user) {
      // 3. Create user if they don't exist
      // Since Google login bypasses OTP, we mark them verified.
      // We need to use the User entity and createWithProfile.
      
      const userEntity = new User(
        null,
        name,
        email,
        'OAUTH_PROVIDER_LOGIN', // Placeholder password
        finalRole
      );
      userEntity.isVerified = true;
      userEntity.isProfileCompleted = false;
      userEntity.avatarUrl = decodedToken.picture || null;

      user = await this.userRepository.createWithProfile(userEntity);
    } else {
      if (user.role === 'admin') {
        throw new Error('Admins cannot login via Google');
      }
      if (user.isDeleted) {
        throw new Error('Your account has been deactivated');
      }
      
      if (!user.isVerified) {
        // The user started an email signup but abandoned the OTP.
        // Now they are logging in with Google. Let's merge/override.
        // Instead of complex profile role switching, delete the unverified record
        // and create a fresh one with the new requested role.
        await this.userRepository.delete(user.id);

        const userEntity = new User(
          null,
          name,
          email,
          'OAUTH_PROVIDER_LOGIN',
          finalRole
        );
        userEntity.isVerified = true;
        userEntity.isProfileCompleted = false;
        userEntity.avatarUrl = decodedToken.picture || null;

        user = await this.userRepository.createWithProfile(userEntity);
      }
    }

    // 4. Generate custom JWTs
    const accessToken = this.authService.generateAccessToken(user);
    const refreshToken = this.authService.generateRefreshToken(user);

    user.refreshToken = refreshToken;
    user.lastLogin = new Date();
    
    // Save refresh token and last login
    await this.userRepository.update(user);

    return { user, accessToken, refreshToken };
  }
}
