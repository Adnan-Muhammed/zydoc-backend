// src/application/usecases/admin/SuspendDoctorUseCase.js

/**
 * Suspends an approved doctor's account.
 * Requires a descriptive suspension reason.
 */
export class SuspendDoctorUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute({ doctorUserId, reason = "", adminUserId }) {
    if (!doctorUserId) {
      throw new Error("Doctor ID is required.");
    }

    if (!reason || typeof reason !== "string" || reason.trim().length < 5) {
      throw new Error("A descriptive suspension reason (at least 5 characters) is required.");
    }

    return await this.userRepository.suspendDoctor({
      doctorUserId,
      reason: reason.trim(),
      adminUserId,
    });
  }
}
