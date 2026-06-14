export class AdminDoctorController {
  constructor(getDoctorsUseCase) {
    this.getDoctorsUseCase = getDoctorsUseCase;
  }

  async getDoctors(req, res) {
    try {
      const doctors = await this.getDoctorsUseCase.execute();

      console.log(doctors);
      
      res.status(200).json({
        success: true,
        doctors,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
}
