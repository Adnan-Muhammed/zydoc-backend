// src/application/usecases/admin/ToggleUserStatusUseCase.js

export class ToggleUserStatusUseCase {
  /**
   * @param {import('../../domain/repositories/UserRepository.js').UserRepository} userRepository
   */
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  /**
   * Execute toggle status
   * @param {Object} params
   * @param {string} params.targetId   - SharedUser._id or profileId
   * @param {string} params.role       - 'doctor' | 'patient'
   * @param {string} params.adminUserId - SharedUser._id of acting admin
   * @param {string} [params.reason]   - Optional reason
   */
  async execute({ targetId, role, adminUserId, reason = "" }) {
    if (!targetId) {
      const error = new Error("Target user ID is required.");
      error.statusCode = 400;
      throw error;
    }

    if (!role || !["doctor", "patient"].includes(role.toLowerCase())) {
      const error = new Error("Valid role ('doctor' or 'patient') is required.");
      error.statusCode = 400;
      throw error;
    }

    return await this.userRepository.toggleUserStatus({
      targetId,
      role: role.toLowerCase(),
      adminUserId,
      reason,
    });
  }
}
