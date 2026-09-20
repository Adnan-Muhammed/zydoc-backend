// src/application/usecases/admin/GetPendingDoctorsUseCase.js

/**
 * Fetches all doctors whose verificationStatus is "pending".
 * Used to power the Admin Approval Queue.
 */
export class GetPendingDoctorsUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(options = {}) {
    return await this.userRepository.getPendingDoctors(options);
  }
}
