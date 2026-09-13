export class GetAppointmentReviewUseCase {
  constructor(reviewRepository) {
    this.reviewRepository = reviewRepository;
  }

  async execute(appointmentId) {
    if (!appointmentId) {
      throw new Error("Appointment ID is required.");
    }

    const review = await this.reviewRepository.findByAppointmentId(appointmentId);
    return {
      reviewed: Boolean(review),
      review: review || null,
    };
  }
}
