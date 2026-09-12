// src/application/usecases/doctor/UpdateDoctorProfile.js
import { validateWorkingHours } from "../../../infrastructure/utils/scheduleValidator.js";

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
    
    const isOnline = consultationSettings?.online?.enabled ?? consultationSettings?.video?.enabled ?? false;
    const isOffline = consultationSettings?.offline?.enabled ?? consultationSettings?.physical?.enabled ?? false;

    if (!isOnline && !isOffline) {
      throw new Error("You must enable at least one consultation type (Telehealth or In-Person).");
    }

    const daysList = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    if (isOnline) {
      const onlineFee = consultationSettings?.online?.fee ?? consultationSettings?.video?.fee;
      if (onlineFee === undefined || onlineFee === null || onlineFee === "") {
        throw new Error("Telehealth fee is required.");
      }
      const hasOnlineDays = daysList.some(day => {
        const dayConfig = wh?.online?.[day];
        if (Array.isArray(dayConfig)) return dayConfig.length > 0;
        return dayConfig?.active;
      });
      if (!hasOnlineDays) {
        throw new Error("At least one available day is required for Telehealth.");
      }
    }

    if (isOffline) {
      const offlineFee = consultationSettings?.offline?.fee ?? consultationSettings?.physical?.fee;
      if (offlineFee === undefined || offlineFee === null || offlineFee === "") {
        throw new Error("In-Person fee is required.");
      }
      const clinicName = consultationSettings?.offline?.clinicName ?? consultationSettings?.physical?.clinicName;
      const clinicAddress = consultationSettings?.offline?.clinicAddress ?? consultationSettings?.physical?.clinicAddress;
      if (!clinicName || !clinicAddress) {
        throw new Error("Clinic Title and Address are required for In-Person visits.");
      }
      const hasOfflineDays = daysList.some(day => {
        const dayConfig = wh?.offline?.[day];
        if (Array.isArray(dayConfig)) return dayConfig.length > 0;
        return dayConfig?.active;
      });
      if (!hasOfflineDays) {
        throw new Error("At least one available day is required for In-Person consultation.");
      }
    }

    // Validate shift durations and prevent overlapping shifts
    validateWorkingHours(wh, Number(profileData.slotDuration) || 15);

    // Standardize consultationSettings to online/offline format
    const standardizedConsultationSettings = {
      online: {
        enabled: isOnline,
        fee: Number(consultationSettings?.online?.fee ?? consultationSettings?.video?.fee ?? 0),
      },
      offline: {
        enabled: isOffline,
        fee: Number(consultationSettings?.offline?.fee ?? consultationSettings?.physical?.fee ?? 0),
        clinicName: consultationSettings?.offline?.clinicName ?? consultationSettings?.physical?.clinicName ?? "",
        clinicAddress: consultationSettings?.offline?.clinicAddress ?? consultationSettings?.physical?.clinicAddress ?? "",
      }
    };

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

      slotDuration: Number(profileData.slotDuration) || 15,

      timezone: profileData.timezone || "Asia/Kolkata",

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
      consultationSettings: standardizedConsultationSettings,

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
