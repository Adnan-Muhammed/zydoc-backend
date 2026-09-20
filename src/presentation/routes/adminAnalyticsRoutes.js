// src/presentation/routes/adminAnalyticsRoutes.js

import express from "express";

// Middleware
import { protect } from "../middleware/authMiddleware.js";
import {
  adminOnly,
  canViewReports,
} from "../middleware/adminMiddleware.js";

// Repository
import { MongoAnalyticsRepository } from "../../infrastructure/repositories/MongoAnalyticsRepository.js";

// Use Cases
import { GetAnalyticsSummaryUseCase } from "../../application/usecases/admin/GetAnalyticsSummaryUseCase.js";
import { GetRevenueChartUseCase } from "../../application/usecases/admin/GetRevenueChartUseCase.js";
import { GetTopDoctorsUseCase } from "../../application/usecases/admin/GetTopDoctorsUseCase.js";
import { GetClinicalAnalyticsUseCase } from "../../application/usecases/admin/GetClinicalAnalyticsUseCase.js";

// Controller
import { AdminAnalyticsController } from "../controllers/AdminAnalyticsController.js";

const router = express.Router();

// ── Dependency Injection ──────────────────────────────────────────────────────
const analyticsRepository = new MongoAnalyticsRepository();

const getAnalyticsSummaryUseCase = new GetAnalyticsSummaryUseCase(analyticsRepository);
const getRevenueChartUseCase = new GetRevenueChartUseCase(analyticsRepository);
const getTopDoctorsUseCase = new GetTopDoctorsUseCase(analyticsRepository);
const getClinicalAnalyticsUseCase = new GetClinicalAnalyticsUseCase(analyticsRepository);

const adminAnalyticsController = new AdminAnalyticsController(
  getAnalyticsSummaryUseCase,
  getRevenueChartUseCase,
  getTopDoctorsUseCase,
  getClinicalAnalyticsUseCase
);

// ── Security Guard for All Analytics Routes ──────────────────────────────────
router.use(protect, adminOnly, canViewReports);

// ── Routes ────────────────────────────────────────────────────────────────────
/**
 * GET /api/admin/analytics/summary
 * Returns high-level KPI dashboard metrics:
 * - Total active doctors & patients
 * - Platform revenue & gross volume
 * - Today's appointments count & breakdown
 */
router.get("/summary", (req, res) => adminAnalyticsController.getSummary(req, res));

/**
 * GET /api/admin/analytics/revenue-chart
 * Returns time-series revenue aggregation comparing admin commission vs. doctor payouts
 * Query params: timeframe (daily | weekly | monthly), days, months, startDate, endDate
 */
router.get("/revenue-chart", (req, res) =>
  adminAnalyticsController.getRevenueChart(req, res)
);

/**
 * GET /api/admin/analytics/top-doctors
 * Returns the top 5 doctors based on completed consultations and total earnings
 * Query params: limit (default: 5)
 */
router.get("/top-doctors", (req, res) =>
  adminAnalyticsController.getTopDoctors(req, res)
);

/**
 * GET /api/admin/analytics/clinical
 * Returns clinical intelligence aggregations for Healthcare Analytics (time series, channels, specialties, utilization, retention, cancellations)
 * Query params: range (7d | 30d | 90d | 1y)
 */
router.get("/clinical", (req, res) =>
  adminAnalyticsController.getClinicalAnalytics(req, res)
);

export default router;
