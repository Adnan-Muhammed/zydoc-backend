// src/application/usecases/patient/UpdatePatientProfile.js

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
      gender: profileData.gender,
      bloodGroup: profileData.bloodGroup,
      
      emergencyContact: {
          name: profileData.emergencyContactName || "",
          relationship: profileData.emergencyContactRelationship || "",
          phone: profileData.emergencyContactPhone || ""
      },
      
      address: {
          street: profileData.street || "",
          city: profileData.city || "",
          state: profileData.state || "",
          zipCode: profileData.zipCode || "",
          country: profileData.country || ""
      },
      
      medicalHistory: {
          allergies: profileData.allergies ? profileData.allergies.split(',').map(s => s.trim()).filter(Boolean) : [],
          chronicConditions: profileData.chronicConditions ? profileData.chronicConditions.split(',').map(s => s.trim()).filter(Boolean) : [],
          currentMedications: profileData.currentMedications ? profileData.currentMedications.split(',').map(s => s.trim()).filter(Boolean) : []
      }
    };

    if (avatar) {
      updateData.avatarUrl = avatar.path.replace(/\\/g, "/");
    }

    const updatedPatient = await this.userRepository.updatePatientProfile(
      userId,
      updateData
    );

    return updatedPatient;
  }
}
