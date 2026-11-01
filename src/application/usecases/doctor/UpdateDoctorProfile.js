// src/application/usecases/doctor/UpdateDoctorProfile.js
import { validateWorkingHours } from "../../../infrastructure/utils/scheduleValidator.js";
import { deduceSystemOfMedicine } from "../../../infrastructure/utils/systemOfMedicineHelper.js";
import { s3StorageService } from "../../../infrastructure/services/S3StorageService.js";
import { uploadValidatedFileToS3 } from "../../../presentation/middleware/uploadMiddleware.js";

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

    const reject = (message) => {
      const error = new Error(message);
      error.statusCode = 400;
      throw error;
    };
    const hasLetters = (value) => /[\p{L}\p{M}]/u.test(value);
    for (const [field, label] of [["firstName", "first"], ["lastName", "last"]]) {
      const value = String(profileData[field] || "").trim();
      if (value.length < 2 || value.length > 50 || !hasLetters(value) || !/^[\p{L}\p{M} .’'-]+$/u.test(value)) reject(`Enter a valid ${label} name.`);
    }
    if (!/^\d{10,15}$/.test(String(profileData.phone || ""))) reject("Phone must contain 10 to 15 digits.");
    const specialty = String(profileData.specialty || "").trim();
    if (specialty.length < 2 || specialty.length > 100 || !hasLetters(specialty) || !/^[\p{L}\p{M}\p{N}\s&()./-]+$/u.test(specialty)) reject("Enter a valid specialty.");
    if (!/^[a-z\d/-]{2,50}$/i.test(String(profileData.licenseNumber || "").trim())) reject("Enter a valid license or registration number.");
    const experience = Number(profileData.yearsOfExperience);
    if (!Number.isInteger(experience) || experience < 0 || experience > 80) reject("Years of experience must be a whole number from 0 to 80.");
    if (String(profileData.bio || "").length > 2000) reject("Bio must be 2,000 characters or fewer.");
    if (!Array.isArray(profileData.qualifications) || profileData.qualifications.length === 0) reject("Add at least one qualification.");
    for (const qualification of profileData.qualifications) {
      const degree = String(qualification.degree || "").trim();
      const institution = String(qualification.institution || "").trim();
      const year = Number(qualification.year);
      if (degree.length < 2 || degree.length > 100 || !hasLetters(degree) || !/^[\p{L}\p{M}\p{N}\s.'&(),/-]+$/u.test(degree) || institution.length < 2 || institution.length > 150 || !hasLetters(institution) || !/^[\p{L}\p{M}\p{N}\s.'&(),/-]+$/u.test(institution) || !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()) reject("Each qualification needs a valid degree, institution, and year.");
    }
    if (!Array.isArray(profileData.expertiseTags || []) || (profileData.expertiseTags || []).some(tag => typeof tag !== "string" || tag.trim().length < 2 || tag.trim().length > 50 || !hasLetters(tag))) reject("Enter valid expertise tags.");
    if (!Array.isArray(profileData.languages || []) || (profileData.languages || []).some(language => typeof language !== "string" || language.trim().length < 2 || language.trim().length > 40 || !hasLetters(language))) reject("Enter valid language selections.");

    // ─────────────────────────────────────
    // Extract uploaded files
    // ─────────────────────────────────────

    const avatar = Array.isArray(files) ? files.find(f => f.fieldname === 'avatar') : files?.avatar?.[0];

    const medicalCertificate = Array.isArray(files) ? files.find(f => f.fieldname === 'medicalCertificate') : files?.medicalCertificate?.[0];

    const governmentId = Array.isArray(files) ? files.find(f => f.fieldname === 'governmentId') : files?.governmentId?.[0];

    const qualificationCertificates = Array.isArray(files) 
      ? files.filter(f => f.fieldname === 'qualificationCertificates') 
      : (files?.qualificationCertificates || []);

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
      if (onlineFee === undefined || onlineFee === null || onlineFee === "" || !Number.isFinite(Number(onlineFee)) || Number(onlineFee) < 0 || Number(onlineFee) > 1000000) {
        reject("Enter a valid telehealth fee.");
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
      if (offlineFee === undefined || offlineFee === null || offlineFee === "" || !Number.isFinite(Number(offlineFee)) || Number(offlineFee) < 0 || Number(offlineFee) > 1000000) {
        reject("Enter a valid in-person fee.");
      }
      const clinicName = consultationSettings?.offline?.clinicName ?? consultationSettings?.physical?.clinicName;
      const clinicAddress = consultationSettings?.offline?.clinicAddress ?? consultationSettings?.physical?.clinicAddress;
      if (!clinicName || !clinicAddress) {
        throw new Error("Clinic Title and Address are required for In-Person visits.");
      }
      const normalizedClinicName = String(clinicName).trim();
      const normalizedClinicAddress = String(clinicAddress).trim();
      if (normalizedClinicName.length < 2 || normalizedClinicName.length > 100 || !hasLetters(normalizedClinicName)) reject("Enter a valid clinic name.");
      if (normalizedClinicAddress.length < 5 || normalizedClinicAddress.length > 200 || !hasLetters(normalizedClinicAddress) || !/^[\p{L}\p{M}\p{N}\s#.,'’&()/-]+$/u.test(normalizedClinicAddress) || /^0+$/.test(normalizedClinicAddress.replace(/[\s,.-]/g, ""))) {
        reject("Enter a valid clinic address with a street or place name.");
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
      systemOfMedicine: deduceSystemOfMedicine(
        profileData.qualifications,
        profileData.systemOfMedicine
      ),

      specialty: profileData.specialty,

      licenseNumber: profileData.licenseNumber,

      yearsOfExperience: Number(profileData.yearsOfExperience) || 0,

      slotDuration: Number(profileData.slotDuration) || 15,

      timezone: profileData.timezone || "Asia/Kolkata",

      expertiseTags: profileData.expertiseTags || [],

      languages: profileData.languages || [],

      qualifications: await Promise.all((profileData.qualifications || []).map(async (q) => {
        const certFile = qualificationCertificates.find(f => f.originalname.startsWith(`${q.id}___`));
        let finalUrl = q.certificateUrl || "";
        if (certFile) {
          if (s3StorageService.isConfigured()) {
            const uploadResult = await uploadValidatedFileToS3(certFile, {
              bucketType: "private",
              prefix: "qual",
              folder: "qualifications",
            });
            finalUrl = uploadResult.key;
          } else {
            finalUrl = certFile.path ? certFile.path.replace(/\\/g, "/") : "";
          }
        }
        
        if (!finalUrl) {
            throw new Error("All qualifications must include a certificate file.");
        }

        return {
          ...q,
          year: Number(q.year) || q.year,
          certificateName: certFile ? certFile.originalname.substring(certFile.originalname.indexOf('___') + 3) : q.certificateName || "",
          certificateUrl: finalUrl,
          certificateStatus: "pending",
          rejectionReason: "",
        };
      })),

      // Consultation
      consultationSettings: standardizedConsultationSettings,

      // Availability
      workingHours: profileData.workingHours,

      // Status
      profileCompleted: true,

      verificationStatus: "pending",
      rejectionReason: "",
      medicalCertificateStatus: "pending",
      medicalCertificateRejectionReason: "",
      governmentIdStatus: "pending",
      governmentIdRejectionReason: "",
    };

    // ─────────────────────────────────────
    // Attach uploaded file paths
    // ─────────────────────────────────────

    const existingProfile = user.doctorProfile || {};

    if (avatar) {
      const normalizedAvatarPath = avatar.path ? avatar.path.replace(/\\/g, "/") : "";
      if (s3StorageService.isConfigured()) {
        const uploadResult = await uploadValidatedFileToS3(avatar, {
          bucketType: "public",
          prefix: "avatar",
          folder: "avatars",
        });
        updateData.avatarUrl = uploadResult.url || uploadResult.key;
      } else {
        updateData.avatarUrl = normalizedAvatarPath;
      }
    } else if (profileData.avatarUrl) {
      updateData.avatarUrl = profileData.avatarUrl;
    } else if (existingProfile.avatarUrl) {
      updateData.avatarUrl = existingProfile.avatarUrl;
    } else if (user.avatarUrl) {
      updateData.avatarUrl = user.avatarUrl;
    } else {
      const err = new Error("Profile picture is mandatory");
      err.statusCode = 400;
      throw err;
    }

    if (medicalCertificate) {
      if (s3StorageService.isConfigured()) {
        const uploadResult = await uploadValidatedFileToS3(medicalCertificate, {
          bucketType: "private",
          prefix: "medcert",
          folder: "medical-certificates",
        });
        updateData.medicalCertificateUrl = uploadResult.key;
      } else {
        updateData.medicalCertificateUrl = medicalCertificate.path ? medicalCertificate.path.replace(/\\/g, "/") : "";
      }
    } else if (!existingProfile.medicalCertificateUrl) {
      throw new Error("Medical Council Registration Certificate is required.");
    }

    if (governmentId) {
      if (s3StorageService.isConfigured()) {
        const uploadResult = await uploadValidatedFileToS3(governmentId, {
          bucketType: "private",
          prefix: "govid",
          folder: "government-ids",
        });
        updateData.governmentIdUrl = uploadResult.key;
      } else {
        updateData.governmentIdUrl = governmentId.path ? governmentId.path.replace(/\\/g, "/") : "";
      }
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
