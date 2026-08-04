// src/application/usecases/patient/GetPatientProfile.js

export class GetPatientProfile {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(userId) {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new Error("Patient not found");
    }

    if (user.role !== "patient") {
      throw new Error("Access denied. User is not a patient.");
    }

    const profile = await this.userRepository.getProfile(userId, 'patient');

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isProfileCompleted: user.isProfileCompleted,
        avatarUrl: user.avatarUrl
      },
      profile: profile || {}
    };
  }
}
