// src/presentation/controllers/PatientController.js

export class PatientController {
  constructor(updatePatientProfileUseCase, getPatientProfileUseCase, jwtService) {
    this.updatePatientProfileUseCase = updatePatientProfileUseCase;
    this.getPatientProfileUseCase = getPatientProfileUseCase;
    this.jwtService = jwtService;
  }

  async getProfile(req, res) {
    try {
      const userId = req.user.id;
      const profileData = await this.getPatientProfileUseCase.execute(userId);
      
      res.status(200).json({
        success: true,
        data: profileData,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const profileData = req.body;
      const files = req.files || {};

      const updatedPatient = await this.updatePatientProfileUseCase.execute(
        userId,
        profileData,
        files
      );

      if (this.jwtService) {
          const newAccessToken = this.jwtService.generateAccessToken({
              id: updatedPatient.id || updatedPatient._id,
              role: updatedPatient.role,
              isProfileCompleted: true,
          });

          res.cookie('accessToken', newAccessToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
              maxAge: 2 * 60 * 1000,
          });
      }

      res.status(200).json({
        success: true,
        message: "Patient profile updated successfully",
        data: updatedPatient,
      });
    } catch (error) {
      if (error.message.includes("already linked")) {
          return res.status(409).json({ success: false, message: error.message });
      }
      res.status(400).json({ success: false, message: error.message });
    }
  }
}
