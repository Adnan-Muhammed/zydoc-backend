// src/application/usecases/patient/UpdatePatientProfile.js
import { uploadValidatedFileToS3 } from "../../../presentation/middleware/uploadMiddleware.js";
import { s3StorageService } from "../../../infrastructure/services/S3StorageService.js";

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

    const avatar = files?.avatar?.[0];

    const updateData = {
      firstName: profileData.firstName,
      lastName: profileData.lastName,
      phone: profileData.phone,
      dateOfBirth: profileData.dateOfBirth,

      emergencyContact: {
          name: profileData.emergencyContactName || profileData.emergencyContact?.name || "",
          relationship: profileData.emergencyContactRelationship || profileData.emergencyContact?.relationship || "",
          phone: profileData.emergencyContactPhone || profileData.emergencyContact?.phone || ""
      },

      address: {
          street: profileData.street || profileData.address?.street || "",
          city: profileData.city || profileData.address?.city || "",
          state: profileData.state || profileData.address?.state || "",
          zipCode: profileData.zipCode || profileData.address?.zipCode || "",
          country: profileData.country || profileData.address?.country || ""
      },

      medicalHistory: {
          allergies: profileData.allergies
              ? profileData.allergies.split(',').map((s) => s.trim()).filter(Boolean)
              : (profileData.medicalHistory?.allergies || []),
          chronicConditions: profileData.chronicConditions
              ? profileData.chronicConditions.split(',').map((s) => s.trim()).filter(Boolean)
              : (profileData.medicalHistory?.chronicConditions || []),
          currentMedications: profileData.currentMedications
              ? profileData.currentMedications.split(',').map((s) => s.trim()).filter(Boolean)
              : (profileData.medicalHistory?.currentMedications || [])
      }
    };

    // Only include enum fields when a valid value is provided — prevents Mongoose
    // validation failures when the user leaves optional dropdowns blank.
    const gender = profileData.gender;
    if (gender && gender !== "") updateData.gender = gender;

    const bloodGroup = profileData.bloodGroup;
    if (bloodGroup && bloodGroup !== "") updateData.bloodGroup = bloodGroup;

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
