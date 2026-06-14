export class GetPublicDoctors {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(filters = {}, options = {}) {
    return await this.userRepository.getPublicDoctors(filters, options);
  }
}
