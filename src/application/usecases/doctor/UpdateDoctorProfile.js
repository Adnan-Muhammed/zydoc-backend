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

    const qualificationCertificates = files?.qualificationCertificates || [];

    // ─────────────────────────────────────
    // Validate Consultation & Working Hours
    // ─────────────────────────────────────

    const { consultationSettings, workingHours: wh } = profileData;
    
    if (!consultationSettings?.video?.enabled && !consultationSettings?.physical?.enabled) {
      throw new Error("You must enable at least one consultation type (Telehealth or In-Person).");
    }

    if (consultationSettings?.video?.enabled) {
      if (consultationSettings.video.fee === undefined || consultationSettings.video.fee === null || consultationSettings.video.fee === "") {
        throw new Error("Telehealth fee is required.");
      }
      const hasOnlineDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].some(day => wh?.online?.[day]?.active);
      if (!hasOnlineDays) {
        throw new Error("At least one available day is required for Telehealth.");
      }
    }

    if (consultationSettings?.physical?.enabled) {
      if (consultationSettings.physical.fee === undefined || consultationSettings.physical.fee === null || consultationSettings.physical.fee === "") {
        throw new Error("In-Person fee is required.");
      }
      if (!consultationSettings.physical.clinicName || !consultationSettings.physical.clinicAddress) {
        throw new Error("Clinic Title and Address are required for In-Person visits.");
      }
      const hasOfflineDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].some(day => wh?.offline?.[day]?.active);
      if (!hasOfflineDays) {
        throw new Error("At least one available day is required for In-Person consultation.");
      }
    }

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

      qualifications: (profileData.qualifications || []).map(q => {
        const certFile = qualificationCertificates.find(f => f.originalname.startsWith(`${q.id}___`));
        const finalUrl = certFile ? certFile.path.replace(/\\/g, "/") : q.certificateUrl || "";
        
        if (!finalUrl) {
            throw new Error("All qualifications must include a certificate file.");
        }

        return {
          ...q,
          certificateName: certFile ? certFile.originalname.substring(certFile.originalname.indexOf('___') + 3) : q.certificateName || "",
          certificateUrl: finalUrl
        };
      }),

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

    const existingProfile = user.doctorProfile || {};

    if (medicalCertificate) {
      updateData.medicalCertificateUrl = medicalCertificate.path.replace(
        /\\/g,
        "/",
      );
    } else if (!existingProfile.medicalCertificateUrl) {
      throw new Error("Medical Council Registration Certificate is required.");
    }

    if (governmentId) {
      updateData.governmentIdUrl = governmentId.path.replace(/\\/g, "/");
    } else if (!existingProfile.governmentIdUrl) {
      throw new Error("Government ID is required.");
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
