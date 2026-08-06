import express from 'express';
import NotificationController from '../controllers/NotificationController.js';
import MongoNotificationRepository from '../../infrastructure/repositories/MongoNotificationRepository.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

const notificationRepository = new MongoNotificationRepository();
const notificationController = new NotificationController(notificationRepository);

// Apply auth middleware to all routes
router.use(protect);

router.get('/', (req, res) => notificationController.getNotifications(req, res));
router.patch('/read-all', (req, res) => notificationController.markAllAsRead(req, res));
router.patch('/:id/read', (req, res) => notificationController.markAsRead(req, res));

export default router;
