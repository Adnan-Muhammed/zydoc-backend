import express from "express";
import { protect } from "../../../presentation/middleware/authMiddleware.js";
import { MongoReviewRepository } from "../repositories/MongoReviewRepository.js";
import { CreateReviewUseCase } from "../use-cases/CreateReviewUseCase.js";
import { GetDoctorReviewsUseCase } from "../use-cases/GetDoctorReviewsUseCase.js";
import { CheckEligibilityUseCase } from "../use-cases/CheckEligibilityUseCase.js";
import { GetAppointmentReviewUseCase } from "../use-cases/GetAppointmentReviewUseCase.js";
import { ReviewController } from "../controllers/ReviewController.js";

const router = express.Router();

// Dependency Injection Composition Root
const reviewRepository = new MongoReviewRepository();
const createReviewUseCase = new CreateReviewUseCase(reviewRepository);
const getDoctorReviewsUseCase = new GetDoctorReviewsUseCase(reviewRepository);
const checkEligibilityUseCase = new CheckEligibilityUseCase(reviewRepository);
const getAppointmentReviewUseCase = new GetAppointmentReviewUseCase(reviewRepository);

const reviewController = new ReviewController(
  createReviewUseCase,
  getDoctorReviewsUseCase,
  checkEligibilityUseCase,
  getAppointmentReviewUseCase
);

// Endpoints
router.post("/", protect, (req, res) => reviewController.createReview(req, res));
router.get("/doctor/:doctorId", (req, res) => reviewController.getDoctorReviews(req, res));
router.get("/eligibility/:doctorId", protect, (req, res) => reviewController.checkEligibility(req, res));
router.get("/appointment/:appointmentId", protect, (req, res) => reviewController.getAppointmentReview(req, res));

export default router;
