// src/application/usecases/patient/AddMedicalRecord.js

import MedicalRecord from "../../../infrastructure/database/models/MedicalRecord.js";

export class AddMedicalRecord {
  async execute(userId, data, file) {
    if (!userId) throw new Error("User ID is required");
    if (!data.title) throw new Error("Title is required");
    if (!file) throw new Error("File is required");

    const fileUrl = file.path.replace(/\\/g, "/");

    const record = new MedicalRecord({
      patientId: userId,
      title: data.title,
      category: data.category || "Other",
      notes: data.notes || "",
      fileUrl: fileUrl,
      date: data.date || new Date()
    });

    await record.save();
    return record;
  }
}
