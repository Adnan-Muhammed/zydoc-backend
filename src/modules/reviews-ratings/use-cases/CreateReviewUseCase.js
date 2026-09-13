import Appointment from "../../../infrastructure/database/models/Appointment.js";

export class CreateReviewUseCase {
  constructor(reviewRepository) {
    this.reviewRepository = reviewRepository;
  }

  async execute({ patientId, appointmentId, rating, comment, tags, isAnonymous }) {
    if (!patientId) {
      throw new Error("Patient ID is required.");
    }

    if (!appointmentId) {
      throw new Error("Appointment ID is required.");
    }

    // 1. Validate whole number rating between 1 and 5
    const numRating = Math.round(Number(rating));
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      throw new Error("Rating must be a whole number between 1 and 5.");
    }

    // 2. Verify the appointment exists
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      throw new Error("Appointment not found.");
    }

    // 3. Verify appointment belongs to this patient (null-safe)
    if (!appointment.patientId || appointment.patientId.toString() !== patientId.toString()) {
      throw new Error("You are not authorized to review this appointment.");
    }

    // 4. Verify appointment status is strictly "completed" or "no-show"
    if (appointment.status !== "completed" && appointment.status !== "no-show") {
      throw new Error(
        `Reviews can only be submitted for completed or no-show consultations. Current status: ${appointment.status}`
      );
    }

    // 5. Check if a review already exists for this appointment
    const existingReview = await this.reviewRepository.findByAppointmentId(appointmentId);
    if (existingReview) {
      throw new Error("You have already reviewed this consultation.");
    }

    // 6. Sanitize inputs
    const doctorId = appointment.doctorId;
    const cleanComment = comment ? String(comment).trim().substring(0, 1000) : "";
    const cleanTags = Array.isArray(tags)
      ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
      : [];

    // 7. Create the review (handles duplicate key race conditions safely)
    let newReview;
    try {
      newReview = await this.reviewRepository.create({
        doctorId,
        patientId,
        appointmentId,
        rating: numRating,
        comment: cleanComment,
        tags: cleanTags,
        isAnonymous: Boolean(isAnonymous),
      });
    } catch (err) {
      if (err.code === 11000) {
        throw new Error("You have already reviewed this consultation.");
      }
      throw err;
    }

    // 8. Recalculate doctor's aggregate rating and review count
    const updatedStats = await this.reviewRepository.recalculateDoctorAggregates(doctorId);

    return {
      review: newReview,
      doctorStats: updatedStats,
    };
  }
}