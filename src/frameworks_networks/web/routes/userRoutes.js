import express from 'express';
import { protect } from '../../../frameworks_networks/web/middleware/authMiddleware.js'; // Assuming middleware exists or needs creation

// Frameworks & Drivers
import UserModel from '../../database/models/UserModel.js';

// Interface Adapters
import { MongoUserRepository } from '../../../interface_adapters/storage/MongoUserRepository.js';
import { JwtService } from '../../../interface_adapters/security/JwtService.js';
import { BcryptService } from '../../../interface_adapters/security/BcryptService.js';
import { UserController } from '../../../interface_adapters/controllers/UserController.js';

// Use Cases
import { GetUserProfile } from '../../../usecases/user/GetUserProfile.js';
import { UpdateUserProfile } from '../../../usecases/user/UpdateUserProfile.js';

const router = express.Router();

// Dependencies
const userRepository = new MongoUserRepository();
const bcryptService = new BcryptService();
const jwtService = new JwtService(); // Logic in usecase might not need this explicitly if only updating data, but authService wrapper does.

const authService = {
    hashPassword: (pwd) => bcryptService.hashPassword(pwd),
    comparePassword: (pwd, hash) => bcryptService.comparePassword(pwd, hash),
    // Token methods not strictly needed for profile update unless we refresh token on password change
    generateAccessToken: (user) => jwtService.generateAccessToken(user),
    generateRefreshToken: (user) => jwtService.generateRefreshToken(user),
};

const getUserProfileUseCase = new GetUserProfile(userRepository);
const updateUserProfileUseCase = new UpdateUserProfile(userRepository, authService);

const userController = new UserController(
    getUserProfileUseCase,
    updateUserProfileUseCase
);

// Routes
router.use(protect); // Protect all routes

router.get('/profile', (req, res) => userController.getProfile(req, res));
router.put('/profile', (req, res) => userController.updateProfile(req, res));

export default router;
