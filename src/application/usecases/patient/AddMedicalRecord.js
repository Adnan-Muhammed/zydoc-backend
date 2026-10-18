import MedicalRecord from "../../../infrastructure/database/models/MedicalRecord.js";
import { uploadValidatedFileToS3 } from "../../../presentation/middleware/uploadMiddleware.js";
import { s3StorageService } from "../../../infrastructure/services/S3StorageService.js";

export class AddMedicalRecord {
  async execute(userId, data, file) {
    if (!userId) throw new Error("User ID is required");
    if (!data.title) throw new Error("Title is required");
    if (!file) throw new Error("File is required");

    let fileUrl = "";
    let uploadedS3Key = null;

    if (s3StorageService.isConfigured()) {
      const uploadResult = await uploadValidatedFileToS3(file, {
        bucketType: "private",
        folder: "medical-records",
        prefix: "medrec",
      });
      fileUrl = uploadResult.key;
      uploadedS3Key = uploadResult.key;
    } else {
      fileUrl = file.filename ? `/uploads/${file.filename}` : (file.path ? file.path.replace(/\\/g, "/") : "");
    }

    const record = new MedicalRecord({
      patientId: userId,
      title: data.title,
      category: data.category || "Other",
      notes: data.notes || "",
      fileUrl: fileUrl,
      date: data.date || new Date()
    });

    try {
      await record.save();
      return record;
    } catch (saveErr) {
      if (uploadedS3Key && s3StorageService.isConfigured()) {
        try {
          await s3StorageService.delete(uploadedS3Key, { bucketType: "private" });
        } catch (delErr) {
          console.error(`[AddMedicalRecord] S3 rollback cleanup failed for ${uploadedS3Key}:`, delErr.message);
        }
      }
      throw saveErr;
    }
  }
}
