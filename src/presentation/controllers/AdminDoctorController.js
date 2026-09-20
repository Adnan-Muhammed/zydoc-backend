// src/presentation/controllers/AdminDoctorController.js

/**
 * ── Admin Doctor Controller ───────────────────────────────────────────────────
 * Handles all admin-facing doctor management HTTP actions.
 * This controller is intentionally thin: it validates HTTP input,
 * delegates to use cases, and maps results back to HTTP responses.
 *
 * Injected use cases:
 *  - getPendingDoctorsUseCase
 *  - getAdminDoctorsUseCase  (renamed from getDoctorsUseCase for clarity)
 *  - approveDoctorUseCase
 *  - rejectDoctorUseCase
 *  - getDoctorStatsUseCase
 */
export class AdminDoctorController {
  constructor(
    getPendingDoctorsUseCase,
    getAdminDoctorsUseCase,
    approveDoctorUseCase,
    rejectDoctorUseCase,
    getDoctorStatsUseCase,
    updateDoctorDocumentStatusUseCase,
    updateDoctorQualificationStatusUseCase,
    suspendDoctorUseCase
  ) {
    this.getPendingDoctorsUseCase = getPendingDoctorsUseCase;
    this.getAdminDoctorsUseCase = getAdminDoctorsUseCase;
    this.approveDoctorUseCase = approveDoctorUseCase;
    this.rejectDoctorUseCase = rejectDoctorUseCase;
    this.getDoctorStatsUseCase = getDoctorStatsUseCase;
    this.updateDoctorDocumentStatusUseCase = updateDoctorDocumentStatusUseCase;
    this.updateDoctorQualificationStatusUseCase = updateDoctorQualificationStatusUseCase;
    this.suspendDoctorUseCase = suspendDoctorUseCase;
  }

  // ── GET /api/admin/doctors/pending ────────────────────────────────────────
  /**
   * Returns a paginated list of doctors awaiting approval.
   * Sorted FIFO (oldest application first) to ensure fair review order.
   *
   * Query params: page, limit
   */
  async getPendingDoctors(req, res) {
    try {
      const { page = 1, limit = 20 } = req.query;

      const result = await this.getPendingDoctorsUseCase.execute({ page, limit });

      return res.status(200).json({
        success: true,
        message: `${result.total} pending doctor application(s) found.`,
        ...result,
      });
    } catch (error) {
      console.error("[getPendingDoctors] Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch pending doctors.",
        error: error.message,
      });
    }
  }

  // ── GET /api/admin/doctors ────────────────────────────────────────────────
  /**
   * Master doctor list with search, filter, and pagination.
   *
   * Query params:
   *   search             - Search by name, specialty, or license number
   *   verificationStatus - Filter: pending | approved | rejected
   *   accountStatus      - Filter: active | suspended
   *   specialty          - Filter by specialty string (partial match)
   *   sort               - newest (default) | oldest | name
   *   page               - Page number (default: 1)
   *   limit              - Results per page (default: 20, max: 100)
   */
  async getDoctors(req, res) {
    try {
      const {
        search,
        verificationStatus,
        accountStatus,
        specialty,
        sort,
        page = 1,
        limit = 20,
      } = req.query;

      const filters = { search, verificationStatus, accountStatus, specialty };
      const options = { sortBy: sort, page, limit };

      const result = await this.getAdminDoctorsUseCase.execute(filters, options);

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("[getDoctors] Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch doctor list.",
        error: error.message,
      });
    }
  }

  // ── POST /api/admin/doctors/:id/approve ───────────────────────────────────
  /**
   * Approves a doctor's application.
   * The admin's identity (req.user.id) is recorded as verifiedBy.
   *
   * Route param: id — the doctor's SharedUser._id
   */
  async approveDoctor(req, res) {
    try {
      const doctorUserId = req.params.id;
      const adminUserId = req.user.id; // Set by protect middleware from JWT
      const { documentStatuses } = req.body || {};

      if (!doctorUserId) {
        return res.status(400).json({
          success: false,
          message: "Doctor ID is required.",
        });
      }

      const result = await this.approveDoctorUseCase.execute({
        doctorUserId,
        adminUserId,
        documentStatuses,
      });

      return res.status(200).json({
        success: true,
        message: `Dr. ${result.profile.firstName} ${result.profile.lastName} has been approved successfully. They can now log in and accept bookings.`,
        doctor: result.doctor,
        profile: result.profile,
      });
    } catch (error) {
      console.error("[approveDoctor] Error:", error.message);

      if (error.message && error.message.startsWith("Cannot approve doctor")) {
        return res.status(400).json({ success: false, message: error.message });
      }
      if (error.message === "Doctor not found") {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.message === "Doctor profile not found") {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.message === "Doctor is already approved") {
        return res.status(409).json({ success: false, message: error.message });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to approve doctor.",
        error: error.message,
      });
    }
  }

  // ── POST /api/admin/doctors/:id/reject ────────────────────────────────────
  /**
   * Rejects a doctor's application with a mandatory reason.
   *
   * Route param: id — the doctor's SharedUser._id
   * Body: { rejectionReason: string (min 10 chars), documentStatuses?: object }
   */
  async rejectDoctor(req, res) {
    try {
      const doctorUserId = req.params.id;
      const adminUserId = req.user.id;
      const { rejectionReason, documentStatuses } = req.body;

      // ── Input validation ──────────────────────────────────────────────────
      if (!doctorUserId) {
        return res.status(400).json({
          success: false,
          message: "Doctor ID is required.",
        });
      }

      if (!rejectionReason || typeof rejectionReason !== "string") {
        return res.status(400).json({
          success: false,
          message: "A rejection reason is required in the request body.",
        });
      }

      if (rejectionReason.trim().length < 10) {
        return res.status(400).json({
          success: false,
          message:
            "Rejection reason must be at least 10 characters. Please provide a clear explanation for the doctor.",
        });
      }

      const result = await this.rejectDoctorUseCase.execute({
        doctorUserId,
        adminUserId,
        rejectionReason: rejectionReason.trim(),
        documentStatuses,
      });

      return res.status(200).json({
        success: true,
        message: `Dr. ${result.profile.firstName} ${result.profile.lastName}'s application has been rejected.`,
        doctor: result.doctor,
        profile: result.profile,
      });
    } catch (error) {
      console.error("[rejectDoctor] Error:", error.message);

      if (error.message === "Doctor not found") {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.message === "Doctor profile not found") {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.message.includes("rejection reason")) {
        return res.status(400).json({ success: false, message: error.message });
      }

      return res.status(500).json({
        success: false,
        message: "Failed to reject doctor.",
        error: error.message,
      });
    }
  }

  // ── GET /api/admin/doctors/stats ──────────────────────────────────────────
  /**
   * Returns aggregate doctor counts (total, pending, approved, rejected, suspended).
   * Used for the KPI cards on the admin dashboard.
   */
  async getDoctorStats(req, res) {
    try {
      const stats = await this.getDoctorStatsUseCase.execute();
      return res.status(200).json({
        success: true,
        stats,
      });
    } catch (error) {
      console.error("[getDoctorStats] Error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch doctor stats.",
        error: error.message,
      });
    }
  }

  // ── PUT /api/admin/doctors/:id/documents/:docType/status ──────────────────
  /**
   * Updates verification status for a specific doctor document.
   * Route params: id (doctor userId), docType (medicalCertificate | governmentId)
   * Body: { status: 'approved' | 'rejected' | 'pending', reason?: string }
   */
  async updateDocumentStatus(req, res) {
    try {
      const doctorUserId = req.params.id;
      const { docType } = req.params;
      const { status, reason } = req.body || {};
      const adminUserId = req.user?.id || req.user?._id;

      const result = await this.updateDoctorDocumentStatusUseCase.execute({
        doctorUserId,
        docType,
        status,
        reason,
        adminUserId,
      });

      return res.status(200).json({
        success: true,
        message: `Document (${docType}) status updated to ${status}.`,
        ...result,
      });
    } catch (error) {
      console.error("[updateDocumentStatus] Error:", error.message);
      const statusCode =
        error.message.includes("not found") ? 404 :
        error.message.includes("Cannot modify") ? 400 :
        error.message.includes("Invalid") || error.message.includes("required") ? 400 : 500;
      return res.status(statusCode).json({
        success: false,
        message: error.message || "Failed to update document status.",
      });
    }
  }

  // ── PUT /api/admin/doctors/:id/qualifications/:qualId/status ──────────────
  /**
   * Updates verification status for a specific qualification degree certificate.
   * Route params: id (doctor userId), qualId (qualification id/index)
   * Body: { status: 'approved' | 'rejected' | 'pending', reason?: string }
   */
  async updateQualificationStatus(req, res) {
    try {
      const doctorUserId = req.params.id;
      const { qualId } = req.params;
      const { status, reason } = req.body || {};
      const adminUserId = req.user?.id || req.user?._id;

      const result = await this.updateDoctorQualificationStatusUseCase.execute({
        doctorUserId,
        qualId,
        status,
        reason,
        adminUserId,
      });

      return res.status(200).json({
        success: true,
        message: `Qualification certificate status updated to ${status}.`,
        ...result,
      });
    } catch (error) {
      console.error("[updateQualificationStatus] Error:", error.message);
      const statusCode =
        error.message.includes("not found") ? 404 :
        error.message.includes("Cannot modify") ? 400 :
        error.message.includes("Invalid") || error.message.includes("required") ? 400 : 500;
      return res.status(statusCode).json({
        success: false,
        message: error.message || "Failed to update qualification status.",
      });
    }
  }

  // ── PUT /api/admin/doctors/:id/suspend ────────────────────────────────────
  /**
   * Suspends an approved doctor's account.
   * Route param: id (doctor userId)
   * Body: { reason: string }
   */
  async suspendDoctor(req, res) {
    try {
      const doctorUserId = req.params.id;
      const { reason } = req.body || {};
      const adminUserId = req.user?.id || req.user?._id;

      const result = await this.suspendDoctorUseCase.execute({
        doctorUserId,
        reason,
        adminUserId,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("[suspendDoctor] Error:", error.message);
      const statusCode =
        error.message.includes("not found") ? 404 :
        error.message.includes("required") ? 400 : 500;
      return res.status(statusCode).json({
        success: false,
        message: error.message || "Failed to suspend doctor.",
      });
    }
  }
}
