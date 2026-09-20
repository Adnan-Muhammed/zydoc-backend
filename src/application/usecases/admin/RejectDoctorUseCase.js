// src/application/usecases/admin/RejectDoctorUseCase.js

/**
 * Rejects a doctor's application with a mandatory reason.
 *
 * Actions performed:
 *  1. Validates the doctor exists and is in pending/approved state
 *  2. Sets verificationStatus → "rejected" on DoctorProfile
 *  3. Sets rejectionReason, verifiedBy, verifiedAt on DoctorProfile
 *  4. Sets SharedUser.accountStatus → "suspended" (blocks login dashboard)
 *  5. Logs the action on AdminProfile.adminActivityLog
 *  6. Sends rejection email to the doctor with the reason
 */
export class RejectDoctorUseCase {
  constructor(userRepository, mailService) {
    this.userRepository = userRepository;
    this.mailService = mailService;
  }

  async execute({ doctorUserId, adminUserId, rejectionReason, documentStatuses }) {
    if (!rejectionReason || rejectionReason.trim().length < 10) {
      throw new Error(
        "A detailed rejection reason (min 10 characters) is required."
      );
    }

    return await this.userRepository.rejectDoctor({
      doctorUserId,
      adminUserId,
      rejectionReason: rejectionReason.trim(),
      documentStatuses,
    });
  }
}
