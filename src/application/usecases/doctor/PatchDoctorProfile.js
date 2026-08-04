// src/application/usecases/doctor/PatchDoctorProfile.js

export class PatchDoctorProfile {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(userId, partialData, files) {
    // 1. Check doctor exists
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new Error("User not found");
    }

    // 2. Build update payload safely
    const updateData = { ...partialData };

    // Handle Certificate Uploads specifically if files are provided
    if (files?.certificates?.length > 0) {
      // Return file paths so controller can merge them with retained certificates
      updateData.newCertificates = files.certificates.map(f => f.path.replace(/\\/g, "/"));
    }

    // 3. Save doctor profile using the repository
    const updatedDoctor = await this.userRepository.updateDoctorProfile(
      userId,
      updateData,
    );

    return updatedDoctor;
  }
}
