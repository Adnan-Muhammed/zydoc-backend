export class GetDoctorsUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute() {
    return await this.userRepository.getApprovedDoctors();
  }
}
