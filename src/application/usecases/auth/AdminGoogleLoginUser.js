// zydoc-backend/src/application/usecases/auth/AdminGoogleLoginUser.js

export class AdminGoogleLoginUser {
  constructor(userRepository, authService, firebaseAuth) {
    this.userRepository = userRepository;
    this.authService = authService;
    this.firebaseAuth = firebaseAuth;
  } 

  async execute({ firebaseToken }) { 
    // 1. Verify Firebase token
    let decodedToken;
    try {
      decodedToken = await this.firebaseAuth.verifyIdToken(firebaseToken);
    } catch (error) {
      console.error("Firebase verifyIdToken error:", error);
      throw new Error('Invalid Firebase Token');
    }

    const email = decodedToken.email;

    // 2. Validate email strictly against process.env.ADMIN_EMAIL
    if (!process.env.ADMIN_EMAIL || email.toLowerCase().trim() !== process.env.ADMIN_EMAIL.toLowerCase().trim()) {
      throw new Error('Unauthorized Google Account. Please use the designated administrator account.');
    }

    // 3. Find admin user in MongoDB
    let user = await this.userRepository.findByEmail(email);

    if (!user || user.role !== 'admin') {
       throw new Error('Invalid admin account');
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
