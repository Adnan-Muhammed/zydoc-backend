// src/application/usecases/patient/GetMedicalRecords.js

import MedicalRecord from "../../../infrastructure/database/models/MedicalRecord.js";

export class GetMedicalRecords {
  async execute(userId) {
    if (!userId) throw new Error("User ID is required");
    const records = await MedicalRecord.find({ patientId: userId }).sort({ date: -1 });
    return records;
  }
}
