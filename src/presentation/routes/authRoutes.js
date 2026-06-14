
//  zydoc-backend/src/frameworks_networks/web/routes/authRoutes.js
import express from 'express';

// Interface Adapters
import { MongoUserRepository } from '../../infrastructure/repositories/MongoUserRepository.js';
import { JwtService } from '../../infrastructure/security/JwtService.js';
import { BcryptService } from '../../infrastructure/security/BcryptService.js';
import { AuthController } from '../controllers/AuthController.js';
import { MailService } from '../../infrastructure/security/MailService.js';
import { ResendOtp } from '../../application/usecases/auth/ResendOtp.js';

// Use Cases
import { SignupUser } from '../../application/usecases/auth/SignupUser.js';
import { VerifyOtp } from '../../application/usecases/auth/VerifyOtp.js';
import { OtpService } from '../../infrastructure/security/OtpService.js';

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
const otpService = new OtpService(); // Required for OTP generation/validation
const mailService = new MailService();

const authService = {
    hashPassword: (pwd) => bcryptService.hashPassword(pwd),
    comparePassword: (pwd, hash) => bcryptService.comparePassword(pwd, hash),
    generateAccessToken: (user) => jwtService.generateAccessToken(user),
    generateRefreshToken: (user) => jwtService.generateRefreshToken(user),
    verifyRefreshToken: (token) => jwtService.verifyRefreshToken(token),
};

// const signupUserUseCase = new SignupUser(userRepository, authService);
const signupUserUseCase = new SignupUser(userRepository, authService, otpService, mailService);
const verifyOtpUseCase = new VerifyOtp(userRepository, authService, otpService); // <--- ADD THIS LINE
const resendOtpUseCase = new ResendOtp(userRepository, otpService, mailService);
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
    getUserProfileUseCase,
    verifyOtpUseCase, // Pass this to controller
    resendOtpUseCase,
);



// Routes
router.post('/signup',
    ((req, res, next) => { return console.log('req', req.body), next() }),
    redirectIfAuth,
    (req, res) => authController.signup(req, res));


router.post('/verify-otp',
    ((req, res, next) => { return console.log('req', req.body), next() }),
    (req, res) => authController.verifyOtp(req, res)); // Added

router.post('/resend-otp',
    ((req, res, next) => { return console.log('req', req.body), next() }),
    ((req, res, next) => { return console.log('resend otp  route'), next() }),
    (req, res) => authController.resendOtp(req, res)); // 4. ADD ROUTE

router.post('/login', redirectIfAuth, (req, res) => authController.login(req, res));
router.post('/refresh', (req, res) => authController.refresh(req, res));
router.post('/logout', (req, res) => authController.logout(req, res));
router.get('/me', protect, (req, res) => authController.getCurrentUser(req, res));

export default router;