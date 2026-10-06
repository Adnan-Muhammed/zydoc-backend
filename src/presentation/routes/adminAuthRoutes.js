import express from 'express';
import { adminAuthController } from '../../infrastructure/di/adminAuthDependencies.js';
import { redirectIfAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Routes mounting at /api/admin/auth
router.post('/login', redirectIfAuth, (req, res) => adminAuthController.adminLogin(req, res));
router.post('/google', redirectIfAuth, (req, res) => adminAuthController.adminGoogleLogin(req, res));
router.post('/refresh', (req, res) => adminAuthController.refresh(req, res));
router.post('/logout', (req, res) => adminAuthController.logout(req, res));

export default router;
