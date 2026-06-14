export class GetPublicDoctorById {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(id) {
    if (!id) {
      throw new Error("Doctor ID is required");
    }
    const doctor = await this.userRepository.getPublicDoctorById(id);
    if (!doctor) {
      throw new Error("Doctor not found or not approved");
    }
    return doctor;
  }
}
