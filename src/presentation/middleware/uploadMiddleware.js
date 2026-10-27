// src/presentation/middleware/uploadMiddleware.js
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  UPLOAD_POLICIES,
  FILE_SIGNATURES,
  validateFileContent,
} from "../../infrastructure/utils/fileValidator.js";
import { s3StorageService } from "../../infrastructure/services/S3StorageService.js";

// This project stores uploaded files in S3. Multer holds the incoming file in
// memory until the application validates it and sends it to the bucket.
const memoryStorage = multer.memoryStorage();

/**
 * Filter factory based on use-case upload policy
 */
function createUploadFilter(policy) {
  const allowedExts = policy.allowedTypes.flatMap((t) => FILE_SIGNATURES[t].exts);
  const allowedMimes = policy.allowedTypes.map((t) => FILE_SIGNATURES[t].mime);

  return (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (!allowedExts.includes(ext) || !allowedMimes.includes(mime)) {
      const err = new Error(
        `Invalid file format for "${file.originalname}". Allowed: ${allowedExts.join(', ')}.`
      );
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    cb(null, true);
  };
}

/**
 * Default generic upload for backward compatibility
 */
const defaultAllowedExts = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
const defaultAllowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

const defaultFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  // Route-specific field-level extension checks
  if (file.fieldname === 'avatar') {
    const avatarExts = ['.jpg', '.jpeg', '.png', '.webp'];
    const avatarMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!avatarExts.includes(ext) || !avatarMimes.includes(mime)) {
      const err = new Error(`Profile image must be JPEG, PNG, or WebP. Received "${ext}".`);
      err.code = 'INVALID_FILE_TYPE';
      return cb(err, false);
    }
    return cb(null, true);
  }

  if (!defaultAllowedExts.includes(ext) || !defaultAllowedMimes.includes(mime)) {
    const err = new Error(
      `Unsupported file type "${ext}". Permitted types: ${defaultAllowedExts.join(', ')}.`
    );
    err.code = 'INVALID_FILE_TYPE';
    return cb(err, false);
  }
  cb(null, true);
};

/**
 * Default disk storage upload instance
 */
const upload = multer({
  storage: memoryStorage,
  fileFilter: defaultFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB max ceiling
    files: 25,
  },
});

/**
 * Safely clean up uploaded files from disk if temporary file paths exist.
 * Never throws or assumes file.path exists (compatible with memory buffer storage).
 *
 * @param {object|object[]} files - Multer file object or array of file objects
 */
export function safeCleanupFiles(files) {
  if (!files) return;
  const fileList = Array.isArray(files) ? files : [files];
  for (const f of fileList) {
    if (!f) continue;
    if (f.path && typeof f.path === "string") {
      try {
        if (fs.existsSync(f.path)) {
          fs.unlinkSync(f.path);
        }
      } catch (unlinkErr) {
        console.error("[UploadCleanup] Error removing temporary file:", unlinkErr.message);
      }
    }
  }
}

/**
 * Post-upload magic byte signature inspection middleware.
 * Verifies that written files (on disk or in buffer) match their allowed binary signature.
 * If validation fails, safely cleans up files and returns HTTP 400 without assuming file.path exists.
 */
export function verifyUploadSignatures(policyResolver) {
  return async (req, res, next) => {
    const filesToValidate = [];

    if (req.file) {
      filesToValidate.push(req.file);
    }
    if (req.files) {
      if (Array.isArray(req.files)) {
        filesToValidate.push(...req.files);
      } else {
        for (const field of Object.keys(req.files)) {
          const val = req.files[field];
          if (Array.isArray(val)) {
            filesToValidate.push(...val);
          } else if (val) {
            filesToValidate.push(val);
          }
        }
      }
    }

    if (filesToValidate.length === 0) {
      return next();
    }

    for (const file of filesToValidate) {
      let policy = UPLOAD_POLICIES.MEDICAL_RECORD;

      if (typeof policyResolver === 'function') {
        policy = policyResolver(file, req);
      } else if (typeof policyResolver === 'object' && policyResolver !== null) {
        policy = policyResolver;
      } else {
        if (file.fieldname === 'avatar') {
          policy = UPLOAD_POLICIES.AVATAR;
        } else if (file.fieldname === 'medicalCertificate' || file.fieldname === 'governmentId') {
          policy = UPLOAD_POLICIES.VERIFICATION_DOC;
        } else if (file.fieldname === 'qualificationCertificates' || file.fieldname.startsWith('certificate_')) {
          policy = UPLOAD_POLICIES.QUALIFICATION;
        } else if (file.fieldname === 'proof' || file.fieldname === 'disputeProof' || req.originalUrl?.includes('/dispute') || req.path?.includes('/dispute')) {
          policy = UPLOAD_POLICIES.DISPUTE_PROOF;
        } else if (req.baseUrl?.includes('appointment')) {
          policy = UPLOAD_POLICIES.CONSULTATION_FILE;
        }
      }

      const check = validateFileContent(file, policy);
      if (!check.valid) {
        // Safely cleanup all uploaded files without assuming f.path exists
        safeCleanupFiles(filesToValidate);
        return res.status(400).json({
          success: false,
          message: check.error || 'File validation failed: invalid format or corrupted file content.',
          field: file.fieldname,
          filename: file.originalname,
        });
      }
    }

    next();
  };
}

/**
 * Specific Multer instances for disk storage with fine-grained limits
 */
export const uploadAvatar = multer({
  storage: memoryStorage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.AVATAR),
  limits: { fileSize: UPLOAD_POLICIES.AVATAR.maxSizeBytes, files: 1 },
});

export const uploadVerificationDoc = multer({
  storage: memoryStorage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.VERIFICATION_DOC),
  limits: { fileSize: UPLOAD_POLICIES.VERIFICATION_DOC.maxSizeBytes },
});

export const uploadMedicalRecord = multer({
  storage: memoryStorage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.MEDICAL_RECORD),
  limits: { fileSize: UPLOAD_POLICIES.MEDICAL_RECORD.maxSizeBytes, files: 1 },
});

export const uploadConsultationAttachment = multer({
  storage: memoryStorage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.CONSULTATION_FILE),
  limits: { fileSize: UPLOAD_POLICIES.CONSULTATION_FILE.maxSizeBytes, files: 1 },
});

/**
 * Memory storage engine and instances for S3 streaming/buffer uploads.
 * Memory limits prevent unbounded RAM use by rejecting oversized files as they stream in.
 */
export const uploadMemory = multer({
  storage: memoryStorage,
  fileFilter: defaultFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB ceiling
    files: 25,
  },
});

export const uploadAvatarMemory = multer({
  storage: memoryStorage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.AVATAR),
  limits: { fileSize: UPLOAD_POLICIES.AVATAR.maxSizeBytes, files: 1 },
});

export const uploadVerificationDocMemory = multer({
  storage: memoryStorage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.VERIFICATION_DOC),
  limits: { fileSize: UPLOAD_POLICIES.VERIFICATION_DOC.maxSizeBytes },
});

export const uploadMedicalRecordMemory = multer({
  storage: memoryStorage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.MEDICAL_RECORD),
  limits: { fileSize: UPLOAD_POLICIES.MEDICAL_RECORD.maxSizeBytes, files: 1 },
});

export const uploadConsultationAttachmentMemory = multer({
  storage: memoryStorage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.CONSULTATION_FILE),
  limits: { fileSize: UPLOAD_POLICIES.CONSULTATION_FILE.maxSizeBytes, files: 1 },
});

/**
 * Safely upload an authenticated, pre-validated Multer file to S3.
 * Enforces that content/signature validation has passed prior to dispatching PutObjectCommand.
 * Automatically extracts buffer (from file.buffer or file.path) and cleans up temporary disk files.
 *
 * @param {object} file - Multer file object (from memory or disk storage)
 * @param {object} options
 * @param {'public'|'private'|string} [options.bucketType='private'] - Target S3 bucket
 * @param {string} [options.prefix='file'] - Key prefix (e.g. 'avatar', 'rec', 'medcert')
 * @param {string} [options.folder=''] - Optional S3 folder prefix
 * @param {object} [options.policy] - UPLOAD_POLICIES entry (defaults to inferred from prefix/fieldname)
 * @param {object} [options.metadata={}] - Optional metadata
 * @param {object} [options.storageService=s3StorageService] - S3 storage service instance
 * @returns {Promise<{ key: string, bucket: string, bucketType: string, url: string|null }>}
 */
export async function uploadValidatedFileToS3(file, {
  bucketType = null,
  prefix = null,
  folder = null,
  policy = null,
  metadata = {},
  storageService = s3StorageService,
} = {}) {
  if (!file) {
    throw new Error("No file provided for S3 upload.");
  }

  const isAvatar = file.fieldname === "avatar" || prefix === "avatar" || folder === "avatars";
  const resolvedBucketType = bucketType || (isAvatar ? "public" : "private");
  const resolvedPrefix = prefix || (isAvatar ? "avatar" : "file");
  const resolvedFolder = folder !== null && folder !== undefined ? folder : (isAvatar ? "avatars" : "");

  // 1. Enforce validation before S3 upload (Rule: Do not upload a file to S3 before validation passes)
  const validationPolicy =
    policy ||
    (prefix === "avatar" || file.fieldname === "avatar"
      ? UPLOAD_POLICIES.AVATAR
      : prefix === "medcert" ||
        prefix === "govid" ||
        file.fieldname === "medicalCertificate" ||
        file.fieldname === "governmentId"
      ? UPLOAD_POLICIES.VERIFICATION_DOC
      : prefix === "qual" || file.fieldname === "qualificationCertificates"
      ? UPLOAD_POLICIES.QUALIFICATION
      : prefix === "rec" || prefix === "medrec"
      ? UPLOAD_POLICIES.MEDICAL_RECORD
      : prefix === "dispute" || prefix === "proof" || file.fieldname === "proof" || file.fieldname === "disputeProof"
      ? UPLOAD_POLICIES.DISPUTE_PROOF
      : UPLOAD_POLICIES.CONSULTATION_FILE);

  const validation = validateFileContent(file, validationPolicy);
  if (!validation.valid) {
    safeCleanupFiles(file);
    const err = new Error(validation.error || "File content validation failed before S3 upload.");
    err.statusCode = 400;
    throw err;
  }

  // 2. Extract buffer payload
  let bodyBuffer = file.buffer;
  if (!bodyBuffer && file.path && fs.existsSync(file.path)) {
    bodyBuffer = fs.readFileSync(file.path);
  }

  if (!bodyBuffer || bodyBuffer.length === 0) {
    safeCleanupFiles(file);
    const err = new Error("Cannot upload empty or unreadable file buffer to S3.");
    err.statusCode = 400;
    throw err;
  }

  // 3. Dispatch to S3
  try {
    const uploadResult = await storageService.upload({
      bucketType: resolvedBucketType,
      body: bodyBuffer,
      prefix: resolvedPrefix,
      originalName: file.originalname || "file.bin",
      folder: resolvedFolder,
      contentType: file.mimetype || "application/octet-stream",
      metadata,
    });

    // Attach results to the file object for downstream consumers
    file.s3Key = uploadResult.key;
    file.s3Bucket = uploadResult.bucket;
    file.s3Url = uploadResult.url;

    // 4. Safely clean up disk temp file if one existed
    if (file.path) {
      safeCleanupFiles(file);
    }

    return uploadResult;
  } catch (s3Error) {
    // If S3 upload rejects, clean up local temp file and bubble error
    safeCleanupFiles(file);
    throw s3Error;
  }
}

export default upload;
