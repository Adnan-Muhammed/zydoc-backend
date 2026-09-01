// src/infrastructure/di/authDependencies.js

import { MongoUserRepository } from "../repositories/MongoUserRepository.js";
import { JwtService } from "../security/JwtService.js";
import { BcryptService } from "../security/BcryptService.js";
import { AuthController } from "../../presentation/controllers/AuthController.js";
import { MailService } from "../security/MailService.js";
import { OtpService } from "../security/OtpService.js";
import { firebaseAuth } from "../security/firebaseAdmin.js";

import { SignupUser } from "../../application/usecases/auth/SignupUser.js";
import { VerifyOtp } from "../../application/usecases/auth/VerifyOtp.js";
import { ResendOtp } from "../../application/usecases/auth/ResendOtp.js";
import { LoginUser } from "../../application/usecases/auth/LoginUser.js";
import { GoogleLoginUser } from "../../application/usecases/auth/GoogleLoginUser.js";
import { SetRole } from "../../application/usecases/auth/SetRole.js";
import { RefreshToken } from "../../application/usecases/auth/RefreshToken.js";
import { LogoutUser } from "../../application/usecases/auth/LogoutUser.js";
import { GetUserProfile } from "../../application/usecases/user/GetUserProfile.js";

// Composition Root for Auth Module
const userRepository = new MongoUserRepository();
const jwtService = new JwtService();
const bcryptService = new BcryptService();
const otpService = new OtpService(); 
const mailService = new MailService(); 

const authService = {
  hashPassword: (pwd) => bcryptService.hashPassword(pwd),
  comparePassword: (pwd, hash) => bcryptService.comparePassword(pwd, hash),
  generateAccessToken: (user) => jwtService.generateAccessToken(user),
  generateRefreshToken: (user) => jwtService.generateRefreshToken(user),
  verifyRefreshToken: (token) => jwtService.verifyRefreshToken(token),
  generateSignupToken: (userId) => jwtService.generateSignupToken(userId),
  verifySignupToken: (token) => jwtService.verifySignupToken(token),
};

const signupUserUseCase = new SignupUser(
  userRepository,
  authService,
  otpService,
  mailService
);
const verifyOtpUseCase = new VerifyOtp(userRepository, authService, otpService);
const resendOtpUseCase = new ResendOtp(userRepository, otpService, mailService);
const loginUserUseCase = new LoginUser(userRepository, authService, otpService, mailService);
const googleLoginUserUseCase = new GoogleLoginUser(
  userRepository,
  authService,
  firebaseAuth
);
const setRoleUseCase = new SetRole(userRepository, authService);
const refreshTokenUseCase = new RefreshToken(userRepository, authService);
const logoutUserUseCase = new LogoutUser(userRepository);
const getUserProfileUseCase = new GetUserProfile(userRepository);

export const authController = new AuthController(
  signupUserUseCase,
  loginUserUseCase,
  null, // AdminLogin moved to separate route
  refreshTokenUseCase,
  logoutUserUseCase,
  getUserProfileUseCase,
  verifyOtpUseCase,
  resendOtpUseCase,
  googleLoginUserUseCase,
  setRoleUseCase
);
