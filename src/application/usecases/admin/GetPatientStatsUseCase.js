// src/application/usecases/admin/GetPatientStatsUseCase.js
export class GetPatientStatsUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute() {
    return await this.userRepository.getAdminPatientStats();
  }
}
