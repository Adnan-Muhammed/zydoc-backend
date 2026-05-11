
//  zydoc-backend/src/frameworks_networks/web/routes/authRoutes.js
import express from 'express';
// Frameworks & Drivers
import UserModel from '../../infrastructure/database/models/UserModel.js';

// Interface Adapters
import { MongoUserRepository } from '../../infrastructure/repositories/MongoUserRepository.js';
import { JwtService } from '../../infrastructure/security/JwtService.js';
import { BcryptService } from '../../infrastructure/security/BcryptService.js';
import { AuthController } from '../controllers/AuthController.js';

// Use Cases
import { SignupUser } from '../../application/usecases/auth/SignupUser.js';
import { LoginUser } from '../../application/usecases/auth/LoginUser.js';
import { RefreshToken } from '../../application/usecases/auth/RefreshToken.js';
import { LogoutUser } from '../../application/usecases/auth/LogoutUser.js';
import { GetUserProfile } from '../../application/usecases/user/GetUserProfile.js';
import { redirectIfAuth, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Dependency Injection (Composition Root for Auth Module)
const userRepository = new MongoUserRepository();
const jwtService = new JwtService();
const bcryptService = new BcryptService();

// Service wrapper to match expected interface if needed, or just pass directly if methods match
// In UseCases we call: authService.hashPassword, comparePassword, generateAccessToken, generateRefreshToken, verifyRefreshToken
// We can combine Jwt and Bcrypt services into one object or class for the UseCase
const authService = {
    hashPassword: (pwd) => bcryptService.hashPassword(pwd),
    comparePassword: (pwd, hash) => bcryptService.comparePassword(pwd, hash),
    generateAccessToken: (user) => jwtService.generateAccessToken(user),
    generateRefreshToken: (user) => jwtService.generateRefreshToken(user),
    verifyRefreshToken: (token) => jwtService.verifyRefreshToken(token),
};

const signupUserUseCase = new SignupUser(userRepository, authService);
const loginUserUseCase = new LoginUser(userRepository, authService);
const refreshTokenUseCase = new RefreshToken(userRepository, authService);
const logoutUserUseCase = new LogoutUser(userRepository);
const getUserProfileUseCase = new GetUserProfile(userRepository);

const authController = new AuthController(
    signupUserUseCase,
    loginUserUseCase,
    null, // AdminLogin moved to separate route
    refreshTokenUseCase,
    logoutUserUseCase,
    getUserProfileUseCase
);



// Routes
router.post('/signup', redirectIfAuth, (req, res) => authController.signup(req, res));
router.post('/login', redirectIfAuth, (req, res) => authController.login(req, res));
router.post('/refresh', (req, res) => authController.refresh(req, res));
router.post('/logout', (req, res) => authController.logout(req, res));
router.get('/me', protect, (req, res) => authController.getCurrentUser(req, res));

export default router;