// src/application/usecases/doctor/PatchDoctorProfile.js
import { uploadValidatedFileToS3 } from "../../../presentation/middleware/uploadMiddleware.js";
import { s3StorageService } from "../../../infrastructure/services/S3StorageService.js";

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
      if (s3StorageService.isConfigured()) {
        updateData.newCertificates = await Promise.all(
          files.certificates.map(async (f) => {
            const uploadResult = await uploadValidatedFileToS3(f, {
              bucketType: "private",
              prefix: "qual",
              folder: "qualifications",
            });
            return uploadResult.key;
          })
        );
      } else {
        updateData.newCertificates = files.certificates.map(f => f.path.replace(/\\/g, "/"));
      }
    }

    // 3. Save doctor profile using the repository
    const updatedDoctor = await this.userRepository.updateDoctorProfile(
      userId,
      updateData,
    );

    return updatedDoctor;
  }
}
