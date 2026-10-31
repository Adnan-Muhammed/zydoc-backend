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

      let newAccessToken;

      if (this.jwtService) {
          newAccessToken = this.jwtService.generateAccessToken({
              id: updatedPatient.id || updatedPatient._id,
              role: updatedPatient.role,
              isProfileCompleted: true,
          });

          //   this line cuurently 2 minutes 
          // but i want to be 15 days
          res.cookie('accessToken', newAccessToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
              ...(process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN
                  ? { domain: process.env.COOKIE_DOMAIN }
                  : {}),
              path: '/',
              maxAge: 15 * 60 * 1000,
          });
      }

      res.status(200).json({
        success: true,
        message: "Patient profile updated successfully",
        data: updatedPatient,
        ...(newAccessToken ? { accessToken: newAccessToken } : {}),
      });
    } catch (error) {
      if (error.message.includes("already linked")) {
          return res.status(409).json({ success: false, message: error.message });
      }
      res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
        ...(error.validationErrors ? { errors: error.validationErrors } : {}),
      });
    }
  }
}
