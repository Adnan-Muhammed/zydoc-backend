// src/application/usecases/doctor/UpdateDoctorProfile.js

export class UpdateDoctorProfile {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute(userId, profileData, files) {
    // ─────────────────────────────────────
    // Check doctor exists
    // ─────────────────────────────────────

    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new Error("User not found");
    }

    // ─────────────────────────────────────
    // Extract uploaded files
    // ─────────────────────────────────────

    const avatar = files?.avatar?.[0];

    const medicalCertificate = files?.medicalCertificate?.[0];

    const governmentId = files?.governmentId?.[0];

    // ─────────────────────────────────────
    // Build update payload
    // ─────────────────────────────────────

    const updateData = {
      // Personal Info
      firstName: profileData.firstName,

      lastName: profileData.lastName,

      phone: profileData.phone,

      bio: profileData.bio,

      // Professional Info
      specialty: profileData.specialty,

      licenseNumber: profileData.licenseNumber,

      yearsOfExperience: profileData.yearsOfExperience,

      expertiseTags: profileData.expertiseTags || [],

      languages: profileData.languages || [],

      qualifications: profileData.qualifications || [],

      // Consultation
      consultationSettings: profileData.consultationSettings,

      // Availability
      workingHours: profileData.workingHours,

      // Status
      profileCompleted: true,

      verificationStatus: "pending",
    };

    // ─────────────────────────────────────
    // Attach uploaded file paths
    // ─────────────────────────────────────

    if (avatar) {
      updateData.avatarUrl = avatar.path.replace(/\\/g, "/"); // Normalize windows paths
    }

    if (medicalCertificate) {
      updateData.medicalCertificateUrl = medicalCertificate.path.replace(
        /\\/g,
        "/",
      );
    }

    if (governmentId) {
      //     updateData.governmentId = {
      //     url: governmentId.path,
      //     originalName: governmentId.originalname,
      //     mimeType: governmentId.mimetype,
      //   };

      updateData.governmentIdUrl = governmentId.path.replace(/\\/g, "/");
    }

    // ─────────────────────────────────────
    // Save doctor profile
    // ─────────────────────────────────────

    const updatedDoctor = await this.userRepository.updateDoctorProfile(
      userId,
      updateData,
    );

    return updatedDoctor;
  }
}
