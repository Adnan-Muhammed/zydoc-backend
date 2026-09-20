// src/presentation/routes/adminNotificationRoutes.js

import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { adminOnly } from "../middleware/adminMiddleware.js";
import { AdminNotificationController } from "../controllers/AdminNotificationController.js";

const router = express.Router();
const adminNotificationController = new AdminNotificationController();

// Guard: Admin authentication
router.use(protect, adminOnly);

/**
 * GET /api/admin/notifications
 * Returns recent system alerts, cron flags, and pending operational tasks
 */
router.get("/", (req, res) => adminNotificationController.getNotifications(req, res));

/**
 * PATCH /api/admin/notifications/read-all
 * Marks all system notifications as read
 */
router.patch("/read-all", (req, res) => adminNotificationController.markAllAsRead(req, res));

/**
 * PATCH /api/admin/notifications/:id/read
 * Marks a specific notification as read
 */
router.patch("/:id/read", (req, res) => adminNotificationController.markAsRead(req, res));

export default router;
