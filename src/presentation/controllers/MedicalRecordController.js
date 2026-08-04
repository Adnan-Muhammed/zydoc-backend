// src/presentation/controllers/MedicalRecordController.js

export class MedicalRecordController {
  constructor(addMedicalRecordUseCase, getMedicalRecordsUseCase, deleteMedicalRecordUseCase) {
    this.addMedicalRecordUseCase = addMedicalRecordUseCase;
    this.getMedicalRecordsUseCase = getMedicalRecordsUseCase;
    this.deleteMedicalRecordUseCase = deleteMedicalRecordUseCase;
  }

  async addRecord(req, res) {
    try {
      const userId = req.user.id;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ success: false, message: "File is required" });
      }

      const record = await this.addMedicalRecordUseCase.execute(userId, req.body, file);

      res.status(201).json({
        success: true,
        message: "Medical record added successfully",
        data: record,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async getRecords(req, res) {
    try {
      const userId = req.user.id;
      const records = await this.getMedicalRecordsUseCase.execute(userId);

      res.status(200).json({
        success: true,
        data: records,
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }

  async deleteRecord(req, res) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      await this.deleteMedicalRecordUseCase.execute(userId, id);

      res.status(200).json({
        success: true,
        message: "Medical record deleted successfully",
      });
    } catch (error) {
      res.status(400).json({ success: false, message: error.message });
    }
  }
}
