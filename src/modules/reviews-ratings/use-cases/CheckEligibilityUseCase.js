export class CheckEligibilityUseCase {
  constructor(reviewRepository) {
    this.reviewRepository = reviewRepository;
  }

  async execute(patientId, doctorId) {
    if (!patientId || !doctorId) {
      throw new Error("Patient ID and Doctor ID are required.");
    }

    const { eligibleAppointments, reviewedAppointments } =
      await this.reviewRepository.findEligibleAppointments(patientId, doctorId);

    const canReview = eligibleAppointments.length > 0;
    const hasReviewed = reviewedAppointments.length > 0;

    return {
      canReview,
      hasReviewed,
      eligibleAppointment: canReview ? eligibleAppointments[0] : null,
      existingReview: hasReviewed ? reviewedAppointments[0] : null,
      totalCompletedConsultations: eligibleAppointments.length + reviewedAppointments.length,
    };
  }
}
