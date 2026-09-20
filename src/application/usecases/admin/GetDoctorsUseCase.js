// src/application/usecases/admin/GetDoctorsUseCase.js

/**
 * Fetches the master list of all doctors with search, filter, and pagination.
 * Delegates to MongoUserRepository.getAdminDoctors().
 */
export class GetDoctorsUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(filters = {}, options = {}) {
    return await this.userRepository.getAdminDoctors(filters, options);
  }
}
