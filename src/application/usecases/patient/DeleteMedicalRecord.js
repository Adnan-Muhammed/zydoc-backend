import fs from "fs";
import path from "path";
import MedicalRecord from "../../../infrastructure/database/models/MedicalRecord.js";
import { sanitizeFilename } from "../../../infrastructure/utils/fileValidator.js";

export class DeleteMedicalRecord {
  async execute(userId, recordId) {
    if (!userId) throw new Error("User ID is required");
    if (!recordId) throw new Error("Record ID is required");
    
    const record = await MedicalRecord.findOneAndDelete({ _id: recordId, patientId: userId });
    if (!record) {
      throw new Error("Medical record not found or you don't have permission to delete it");
    }

    // Safely unlink physical file if stored locally in uploads
    if (record.fileUrl) {
      try {
        const rawFilename = path.basename(record.fileUrl);
        const cleanFilename = sanitizeFilename(rawFilename);
        if (cleanFilename && !cleanFilename.includes("..")) {
          const uploadsDir = path.resolve("uploads");
          const targetPath = path.resolve(uploadsDir, cleanFilename);
          if (targetPath.startsWith(uploadsDir) && fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
          }
        }
      } catch (err) {
        console.error(`[DeleteMedicalRecord] Failed to unlink file on disk (${record.fileUrl}):`, err.message);
      }
    }
    
    return record;
  }
}

