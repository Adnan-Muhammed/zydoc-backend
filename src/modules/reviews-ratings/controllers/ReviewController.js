export class ReviewController {
  constructor(
    createReviewUseCase,
    getDoctorReviewsUseCase,
    checkEligibilityUseCase,
    getAppointmentReviewUseCase
  ) {
    this.createReviewUseCase = createReviewUseCase;
    this.getDoctorReviewsUseCase = getDoctorReviewsUseCase;
    this.checkEligibilityUseCase = checkEligibilityUseCase;
    this.getAppointmentReviewUseCase = getAppointmentReviewUseCase;
  }

  /**
   * POST /api/reviews
   * Submit a new rating & review for a completed appointment
   */
  async createReview(req, res) {
    try {
      const patientId = req.user?.id || req.user?._id;
      if (!patientId) {
        return res.status(401).json({ success: false, message: "Unauthorized. User ID not found." });
      }

      const { appointmentId, rating, comment, tags, isAnonymous } = req.body;

      const result = await this.createReviewUseCase.execute({
        patientId,
        appointmentId,
        rating,
        comment,
        tags,
        isAnonymous,
      });

      return res.status(201).json({
        success: true,
        message: "Review submitted successfully! Thank you for your feedback.",
        data: result,
      });
    } catch (error) {
      console.error("[ReviewController.createReview] Error:", error.message);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to submit review.",
      });
    }
  }

  /**
   * GET /api/reviews/doctor/:doctorId
   * Public: Get reviews list and rating breakdown stats for a doctor
   */
  async getDoctorReviews(req, res) {
    try {
      const { doctorId } = req.params;
      const { page = 1, limit = 10, rating = null } = req.query;

      const result = await this.getDoctorReviewsUseCase.execute(doctorId, {
        page: Number(page),
        limit: Number(limit),
        ratingFilter: rating,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("[ReviewController.getDoctorReviews] Error:", error.message);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to retrieve doctor reviews.",
      });
    }
  }

  /**
   * GET /api/reviews/eligibility/:doctorId
   * Patient-only: Check if patient is eligible to review this doctor
   */
  async checkEligibility(req, res) {
    try {
      const patientId = req.user?.id || req.user?._id;
      if (!patientId) {
        return res.status(401).json({ success: false, message: "Unauthorized." });
      }

      const { doctorId } = req.params;
      const result = await this.checkEligibilityUseCase.execute(patientId, doctorId);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("[ReviewController.checkEligibility] Error:", error.message);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to check review eligibility.",
      });
    }
  }

  /**
   * GET /api/reviews/appointment/:appointmentId
   * Check if specific appointment has been reviewed
   */
  async getAppointmentReview(req, res) {
    try {
      const { appointmentId } = req.params;
      const result = await this.getAppointmentReviewUseCase.execute(appointmentId);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("[ReviewController.getAppointmentReview] Error:", error.message);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to fetch appointment review status.",
      });
    }
  }
}
