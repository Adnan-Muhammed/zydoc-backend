// src/application/usecases/admin/GetPatientsUseCase.js
export class GetPatientsUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(filters, options) {
    return await this.userRepository.getAdminPatients(filters, options);
  }
}
