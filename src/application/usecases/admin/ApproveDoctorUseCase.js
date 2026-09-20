// src/application/usecases/admin/ApproveDoctorUseCase.js

/**
 * Approves a doctor's application.
 *
 * Actions performed:
 *  1. Validates the doctor exists and is still pending
 *  2. Sets verificationStatus → "approved" on DoctorProfile
 *  3. Sets verifiedBy + verifiedAt on DoctorProfile  
 *  4. Approves all sub-documents (medicalCertificate, governmentId, qualifications)
 *  5. Sets SharedUser.accountStatus → "active" (so they can log in with full access)
 *  6. Logs the action on AdminProfile.adminActivityLog
 *  7. Sends approval email to the doctor
 */
export class ApproveDoctorUseCase {
  constructor(userRepository, mailService) {
    this.userRepository = userRepository;
    this.mailService = mailService; // optional: can be null if email not set up
  }

  async execute({ doctorUserId, adminUserId, documentStatuses }) {
    return await this.userRepository.approveDoctor({ doctorUserId, adminUserId, documentStatuses });
  }
}
