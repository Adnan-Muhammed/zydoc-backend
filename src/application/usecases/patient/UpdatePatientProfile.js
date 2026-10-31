// src/application/usecases/patient/UpdatePatientProfile.js
import { uploadValidatedFileToS3 } from "../../../presentation/middleware/uploadMiddleware.js";
import { s3StorageService } from "../../../infrastructure/services/S3StorageService.js";
import { validatePatientProfilePayload } from "../../validators/PatientProfileValidator.js";

export class UpdatePatientProfile {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(userId, profileData, files = {}) {
    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new Error("User not found");
    }

    if (user.role !== "patient") {
        throw new Error("User is not a patient");
    }

    const { errors, clean } = validatePatientProfilePayload(profileData);
    if (Object.keys(errors).length > 0) {
      const validationError = new Error("Please correct the invalid profile fields.");
      validationError.statusCode = 400;
      validationError.validationErrors = errors;
      throw validationError;
    }

    const avatar = files?.avatar?.[0];

    const updateData = {
      firstName: clean.firstName,
      lastName: clean.lastName,
      phone: clean.phone,
      dateOfBirth: clean.dateOfBirth,

      emergencyContact: {
          name: clean.emergencyContactName,
          relationship: clean.emergencyContactRelationship,
          phone: clean.emergencyContactPhone
      },

      address: {
          street: clean.street,
          city: clean.city,
          state: clean.state,
          zipCode: clean.zipCode,
          country: clean.country
      },

      medicalHistory: {
          allergies: clean.allergies.split(',').map((s) => s.trim()).filter(Boolean),
          chronicConditions: clean.chronicConditions.split(',').map((s) => s.trim()).filter(Boolean),
          currentMedications: clean.currentMedications.split(',').map((s) => s.trim()).filter(Boolean)
      }
    };

    updateData.gender = clean.gender;
    updateData.bloodGroup = clean.bloodGroup;

    if (avatar) {
      if (s3StorageService.isConfigured()) {
        const uploadResult = await uploadValidatedFileToS3(avatar, {
          bucketType: "public",
          prefix: "avatar",
          folder: "avatars",
        });
        updateData.avatarUrl = uploadResult.url || uploadResult.key;
      } else {
        updateData.avatarUrl = avatar.path ? avatar.path.replace(/\\/g, "/") : "";
      }
    }

    const updatedPatient = await this.userRepository.updatePatientProfile(
      userId,
      updateData
    );

    return updatedPatient;
  }
}
