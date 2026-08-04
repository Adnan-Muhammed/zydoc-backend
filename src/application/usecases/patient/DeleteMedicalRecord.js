// src/application/usecases/patient/DeleteMedicalRecord.js

import MedicalRecord from "../../../infrastructure/database/models/MedicalRecord.js";

export class DeleteMedicalRecord {
  async execute(userId, recordId) {
    if (!userId) throw new Error("User ID is required");
    if (!recordId) throw new Error("Record ID is required");
    
    const record = await MedicalRecord.findOneAndDelete({ _id: recordId, patientId: userId });
    if (!record) {
      throw new Error("Medical record not found or you don't have permission to delete it");
    }
    
    return record;
  }
}
