// src/application/usecases/admin/UpdateDoctorDocumentStatusUseCase.js

/**
 * Updates a doctor's specific document status (medicalCertificate or governmentId).
 * Enforces validation and rejection reason requirements.
 */
export class UpdateDoctorDocumentStatusUseCase {
  constructor(userRepository) {
    this.userRepository = userRepository;
  }

  async execute({ doctorUserId, docType, status, reason = "", adminUserId }) {
    if (!doctorUserId) {
      throw new Error("Doctor ID is required.");
    }

    if (!docType || !["medicalCertificate", "governmentId"].includes(docType)) {
      throw new Error("Invalid document type. Must be 'medicalCertificate' or 'governmentId'.");
    }

    if (!status || !["pending", "approved", "rejected"].includes(status)) {
      throw new Error("Invalid status. Must be 'pending', 'approved', or 'rejected'.");
    }

    if (status === "rejected" && (!reason || typeof reason !== "string" || reason.trim().length === 0)) {
      throw new Error("A rejection reason is required when rejecting a document.");
    }

    return await this.userRepository.updateDoctorDocumentStatus({
      doctorUserId,
      docType,
      status,
      reason: reason ? reason.trim() : "",
      adminUserId,
    });
  }
}
