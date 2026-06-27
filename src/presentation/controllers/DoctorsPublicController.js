export class DoctorsPublicController {
  constructor(getPublicDoctorsUseCase, getPublicDoctorByIdUseCase) {
    this.getPublicDoctorsUseCase = getPublicDoctorsUseCase;
    this.getPublicDoctorByIdUseCase = getPublicDoctorByIdUseCase;
  }

  async getDoctors(req, res) {
    console.log('doctors list controller');
    
    try {
      const { search, specialty, consultationType, minRating, page, limit, sortBy, sortOrder } = req.query;
      
      const filters = {
        search,
        specialty, 
        consultationType,
        minRating
      };

      const options = {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 10,
        sortBy,
        sortOrder
      }; 

      const result = await this.getPublicDoctorsUseCase.execute(filters, options);


      console.log(result);
      
      res.status(200).json({
        success: true,
        ...result
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }

  async getDoctorById(req, res) {
    try {
      const { id } = req.params;
      const doctor = await this.getPublicDoctorByIdUseCase.execute(id);

      res.status(200).json({
        success: true,
        doctor
      });
    } catch (error) {
      const status = error.message === "Doctor not found or not approved" ? 404 : 400;
      res.status(status).json({
        success: false,
        message: error.message
      });
    }
  }
}
