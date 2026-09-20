import express from 'express';
import { getWalletDetails } from '../controllers/WalletController.js';
import { protect } from '../middleware/authMiddleware.js';
import { roles } from '../middleware/roleMiddleware.js';

const router = express.Router();

// GET /api/patient/wallet or /api/wallet
router.get('/', protect, roles(['patient']), getWalletDetails);
router.get('/wallet', protect, roles(['patient']), getWalletDetails);

export default router;
