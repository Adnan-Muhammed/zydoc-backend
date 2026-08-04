export class GetDoctorsUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(filters = {}, options = {}) {
    if (this.userRepository.getAdminDoctors) {
      return await this.userRepository.getAdminDoctors(filters, options);
    }
    return await this.userRepository.getDoctors();
  }
}
