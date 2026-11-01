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

    const invalid = (message, field) => {
      const error = new Error(message);
      error.statusCode = 400;
      error.field = field;
      throw error;
    };
    const hasLetters = (value) => /[\p{L}\p{M}]/u.test(value);
    if (partialData.phone !== undefined && !/^\d{10,15}$/.test(String(partialData.phone))) {
      invalid("Phone must contain 10 to 15 digits.", "phone");
    }
    for (const field of ["firstName", "lastName"]) {
      if (partialData[field] !== undefined) {
        const value = String(partialData[field]).trim();
        if (value.length < 2 || value.length > 50 || !hasLetters(value) || !/^[\p{L}\p{M} .’'-]+$/u.test(value)) {
          invalid(`Enter a valid ${field === "firstName" ? "first" : "last"} name.`, field);
        }
      }
    }
    if (partialData.specialty !== undefined) {
      const value = String(partialData.specialty).trim();
      if (value.length < 2 || value.length > 100 || !hasLetters(value)) invalid("Enter a valid specialty.", "specialty");
    }
    if (partialData.licenseNumber !== undefined) {
      const value = String(partialData.licenseNumber).trim();
      if (!/^[a-z\d/-]{2,50}$/i.test(value)) invalid("Enter a valid license or registration number.", "licenseNumber");
    }
    if (partialData.yearsOfExperience !== undefined) {
      const value = Number(partialData.yearsOfExperience);
      if (!Number.isInteger(value) || value < 0 || value > 80) invalid("Years of experience must be a whole number from 0 to 80.", "yearsOfExperience");
    }
    if (partialData.bio !== undefined && String(partialData.bio).length > 2000) invalid("Bio must be 2,000 characters or fewer.", "bio");
    if (partialData.expertiseTags !== undefined && (!Array.isArray(partialData.expertiseTags) || partialData.expertiseTags.some(tag => typeof tag !== "string" || tag.trim().length < 2 || tag.trim().length > 50 || !hasLetters(tag) || !/^[\p{L}\p{M}\p{N}\s&()/-]+$/u.test(tag)))) invalid("Enter valid expertise tags.", "expertiseTags");
    if (partialData.selectedLanguages !== undefined && (!Array.isArray(partialData.selectedLanguages) || partialData.selectedLanguages.some(language => !["English", "Malayalam", "Hindi", "Tamil", "Kannada", "Arabic"].includes(language)))) invalid("Choose valid languages from the available list.", "selectedLanguages");
    if (partialData.consultationSettings) {
      const settings = partialData.consultationSettings;
      const online = settings.online || {};
      const offline = settings.offline || {};
      if (!online.enabled && !offline.enabled) invalid("Enable at least one consultation type.", "consultationSettings");
      for (const [enabled, fee, label, field] of [[online.enabled, online.fee, "video", "videoFee"], [offline.enabled, offline.fee, "in-person", "physicalFee"]]) {
        if (enabled && (!Number.isFinite(Number(fee)) || Number(fee) < 0 || Number(fee) > 1000000)) invalid(`Enter a valid ${label} fee.`, field);
      }
      if (offline.enabled) {
        const clinicName = String(offline.clinicName || "").trim();
        const clinicAddress = String(offline.clinicAddress || "").trim();
        if (clinicName.length < 2 || clinicName.length > 100 || !hasLetters(clinicName)) invalid("Enter a valid clinic name.", "clinicName");
        if (clinicAddress.length < 5 || clinicAddress.length > 200 || !hasLetters(clinicAddress) || !/^[\p{L}\p{M}\p{N}\s#.,'’&()/-]+$/u.test(clinicAddress) || /^0+$/.test(clinicAddress.replace(/[\s,.-]/g, ""))) invalid("Enter a valid clinic address with a street or place name.", "clinicAddress");
      }
    }
    if (Array.isArray(partialData.qualifications)) {
      if (partialData.qualifications.length === 0) invalid("Add at least one qualification.", "qualifications");
      for (const q of partialData.qualifications) {
        const degree = String(q.degree || "").trim();
        const institution = String(q.institution || "").trim();
        const year = Number(q.year);
        if (degree.length < 2 || degree.length > 100 || !hasLetters(degree) || !/^[\p{L}\p{M}\p{N}\s.'&(),/-]+$/u.test(degree) || institution.length < 2 || institution.length > 150 || !hasLetters(institution) || !/^[\p{L}\p{M}\p{N}\s.'&(),/-]+$/u.test(institution) || !/^\d{4}$/.test(String(q.year)) || year < 1900 || year > new Date().getFullYear()) {
          invalid("Each qualification needs a valid degree, institution, and year.", "qualifications");
        }
        if (!q.certificateUrl) invalid("Each qualification must include its certificate file.", "qualifications");
      }
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
