import fs from "fs";
import path from "path";
import MedicalRecord from "../../../infrastructure/database/models/MedicalRecord.js";
import { sanitizeFilename } from "../../../infrastructure/utils/fileValidator.js";
import { s3StorageService } from "../../../infrastructure/services/S3StorageService.js";

export class DeleteMedicalRecord {
  async execute(userId, recordId) {
    if (!userId) throw new Error("User ID is required");
    if (!recordId) throw new Error("Record ID is required");
    
    const record = await MedicalRecord.findOneAndDelete({ _id: recordId, patientId: userId });
    if (!record) {
      throw new Error("Medical record not found or you don't have permission to delete it");
    }

    if (record.fileUrl) {
      // Safely delete file from S3 if configured and not purely a local path on disk
      if (s3StorageService.isConfigured() && (record.fileUrl.startsWith("medical-records/") || (!record.fileUrl.includes("\\") && !fs.existsSync(record.fileUrl)))) {
        try {
          const cleanKey = s3StorageService.extractObjectKey(record.fileUrl);
          await s3StorageService.delete(cleanKey, { bucketType: "private" });
        } catch (s3Err) {
          console.error(`[DeleteMedicalRecord] Failed to delete S3 object (${record.fileUrl}):`, s3Err.message);
        }
      }

      // Safely unlink physical file if stored locally in uploads
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

