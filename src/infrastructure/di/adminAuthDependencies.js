// zydoc-backend/src/infrastructure/di/adminAuthDependencies.js

import { MongoUserRepository } from "../repositories/MongoUserRepository.js";
import { JwtService } from "../security/JwtService.js";
import { BcryptService } from "../security/BcryptService.js";
import { firebaseAuth } from "../security/firebaseAdmin.js";
import { AdminAuthController } from "../../presentation/controllers/AdminAuthController.js";

import { AdminLoginUser } from "../../application/usecases/auth/AdminLoginUser.js";
import { AdminGoogleLoginUser } from "../../application/usecases/auth/AdminGoogleLoginUser.js";
import { RefreshToken } from "../../application/usecases/auth/RefreshToken.js";
import { LogoutUser } from "../../application/usecases/auth/LogoutUser.js";

// Composition Root for Admin Auth Module
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

const adminLoginUserUseCase = new AdminLoginUser(userRepository, authService);
const adminGoogleLoginUserUseCase = new AdminGoogleLoginUser(userRepository, authService, firebaseAuth);
const refreshTokenUseCase = new RefreshToken(userRepository, authService);
const logoutUserUseCase = new LogoutUser(userRepository);

export const adminAuthController = new AdminAuthController(
  adminLoginUserUseCase,
  adminGoogleLoginUserUseCase,
  refreshTokenUseCase,
  logoutUserUseCase
);
