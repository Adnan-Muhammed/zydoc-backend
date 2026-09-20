// src/presentation/controllers/AdminUserController.js

export class AdminUserController {
  /**
   * @param {import('../../application/usecases/admin/ToggleUserStatusUseCase.js').ToggleUserStatusUseCase} toggleUserStatusUseCase
   */
  constructor(toggleUserStatusUseCase) {
    this.toggleUserStatusUseCase = toggleUserStatusUseCase;
  }

  // ── POST /api/admin/users/doctors/:id/toggle-status ───────────────────────
  async toggleDoctorStatus(req, res) {
    try {
      const { id } = req.params;
      const { reason = "" } = req.body;
      const adminUserId = req.user?.id || req.user?._id;

      const result = await this.toggleUserStatusUseCase.execute({
        targetId: id,
        role: "doctor",
        adminUserId,
        reason,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("[toggleDoctorStatus] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to toggle doctor account status.",
      });
    }
  }

  // ── POST /api/admin/users/patients/:id/toggle-status ──────────────────────
  async togglePatientStatus(req, res) {
    try {
      const { id } = req.params;
      const { reason = "" } = req.body;
      const adminUserId = req.user?.id || req.user?._id;

      const result = await this.toggleUserStatusUseCase.execute({
        targetId: id,
        role: "patient",
        adminUserId,
        reason,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      console.error("[togglePatientStatus] Error:", error.message);
      return res.status(error.statusCode || 500).json({
        success: false,
        message: error.message || "Failed to toggle patient account status.",
      });
    }
  }
}