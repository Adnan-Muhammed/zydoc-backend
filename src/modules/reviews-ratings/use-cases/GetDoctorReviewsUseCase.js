export class GetDoctorReviewsUseCase {
  constructor(reviewRepository) {
    this.reviewRepository = reviewRepository;
  }

  async execute(doctorId, { page = 1, limit = 10, ratingFilter = null } = {}) {
    if (!doctorId) {
      throw new Error("Doctor ID is required.");
    }

    const [reviewsResult, stats] = await Promise.all([
      this.reviewRepository.findByDoctorId(doctorId, { page, limit, ratingFilter }),
      this.reviewRepository.getDoctorRatingBreakdown(doctorId),
    ]);

    return {
      reviews: reviewsResult.reviews,
      pagination: {
        total: reviewsResult.total,
        page: reviewsResult.page,
        totalPages: reviewsResult.totalPages,
        limit: Number(limit),
      },
      stats,
    };
  }
}
