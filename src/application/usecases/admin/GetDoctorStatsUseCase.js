export class GetDoctorStatsUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute() {
    return await this.userRepository.getAdminDoctorStats();
  }
}
