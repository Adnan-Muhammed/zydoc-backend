import express from 'express';

// Interface Adapters
import { MongoUserRepository } from '../../../interface_adapters/storage/MongoUserRepository.js';
import { JwtService } from '../../../interface_adapters/security/JwtService.js';
import { BcryptService } from '../../../interface_adapters/security/BcryptService.js';
import { AuthController } from '../../../interface_adapters/controllers/AuthController.js';

// Use Cases
import { AdminLoginUser } from '../../../usecases/auth/AdminLoginUser.js';

const router = express.Router();

// Dependency Injection
const userRepository = new MongoUserRepository();
const jwtService = new JwtService();
const bcryptService = new BcryptService();

const authService = {
    hashPassword: (pwd) => bcryptService.hashPassword(pwd),
    comparePassword: (pwd, hash) => bcryptService.comparePassword(pwd, hash),
    generateAccessToken: (user) => jwtService.generateAccessToken(user),
    generateRefreshToken: (user) => jwtService.generateRefreshToken(user),
    verifyRefreshToken: (token) => jwtService.verifyRefreshToken(token),
};

// We only need AdminLoginUser here for now
const adminLoginUserUseCase = new AdminLoginUser(userRepository, authService);

// We can reuse AuthController, but we need to pass null for other use cases not used here,
// OR create a specific AdminAuthController. 
// Reusing AuthController with partial dependencies is a bit messy if the constructor enforces 5 arguments.
// Let's check AuthController constructor.
// constructor(signupUser, loginUser, adminLoginUser, refreshToken, logoutUser)
// We can pass null for others if we only use adminLogin method.

const authController = new AuthController(
    null, // signup
    null, // login
    adminLoginUserUseCase,
    null, // refresh
    null  // logout
);

// Routes mounting at /api/admin/auth
router.post('/login', (req, res) => authController.adminLogin(req, res));

export default router;
