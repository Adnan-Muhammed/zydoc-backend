// src/application/usecases/admin/UpdateDoctorQualificationStatusUseCase.js

/**
 * Updates a doctor's individual qualification certificate status.
 * Enforces validation and rejection reason requirements.
 */
export class UpdateDoctorQualificationStatusUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute({ doctorUserId, qualId, status, reason = "", adminUserId }) {
    if (!doctorUserId) {
      throw new Error("Doctor ID is required.");
    }

    if (!qualId) {
      throw new Error("Qualification ID is required.");
    }

    if (!status || !["pending", "approved", "rejected"].includes(status)) {
      throw new Error("Invalid status. Must be 'pending', 'approved', or 'rejected'.");
    }

    if (status === "rejected" && (!reason || typeof reason !== "string" || reason.trim().length === 0)) {
      throw new Error("A rejection reason is required when rejecting a qualification certificate.");
    }

    return await this.userRepository.updateDoctorQualificationStatus({
      doctorUserId,
      qualId,
      status,
      reason: reason ? reason.trim() : "",
      adminUserId,
    });
  }
}
