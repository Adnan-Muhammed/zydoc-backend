// zydoc-backend/src/presentation/routes/authRoutes.js
import express from "express";
import { authController } from "../../infrastructure/di/authDependencies.js";
import { redirectIfAuth, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Routes
router.post(
  "/signup",
  redirectIfAuth,
  (req, res) => authController.signup(req, res),
);

router.post("/verify-otp", (req, res) => authController.verifyOtp(req, res));

router.post("/resend-otp", (req, res) => authController.resendOtp(req, res));

router.post("/login", redirectIfAuth, (req, res) =>
  authController.login(req, res),
);
router.post("/google", redirectIfAuth, (req, res) =>
  authController.googleLogin(req, res),
);
router.patch("/set-role", protect, (req, res) => {
  return authController.setRole(req, res);
});
router.post("/refresh", (req, res) => authController.refresh(req, res));
router.post("/logout", (req, res) => authController.logout(req, res));
router.get("/me", protect, (req, res) =>
  authController.getCurrentUser(req, res),
);

export default router;
