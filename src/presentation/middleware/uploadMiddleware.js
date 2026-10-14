// src/presentation/middleware/uploadMiddleware.js
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  UPLOAD_POLICIES,
  FILE_SIGNATURES,
  validateFileContent,
  generateSecureFilename,
} from "../../infrastructure/utils/fileValidator.js";

// Uploads destination directory
const uploadPath = "uploads/";

if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

/**
 * Disk storage engine using cryptographically random UUID filenames
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    let prefix = 'file';
    if (file.fieldname === 'avatar') prefix = 'avatar';
    else if (file.fieldname === 'medicalCertificate') prefix = 'medcert';
    else if (file.fieldname === 'governmentId') prefix = 'govid';
    else if (file.fieldname === 'qualificationCertificates' || file.fieldname.startsWith('certificate_')) prefix = 'qual';
    else if (file.fieldname === 'file') prefix = 'rec';

    const uniqueName = generateSecureFilename(prefix, file.originalname);
    cb(null, uniqueName);
  },
});

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

const upload = multer({
  storage,
  fileFilter: defaultFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max ceiling
    files: 25,
  },
});

/**
 * Post-upload magic byte signature inspection middleware
 * Verifies that written files on disk match their allowed binary signature.
 * If validation fails, safely unlinks files from disk and returns HTTP 400.
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
          filesToValidate.push(...req.files[field]);
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
        } else if (req.baseUrl?.includes('appointment')) {
          policy = UPLOAD_POLICIES.CONSULTATION_FILE;
        }
      }

      const check = validateFileContent(file, policy);
      if (!check.valid) {
        // Cleanup all uploaded files from disk immediately
        for (const f of filesToValidate) {
          if (f.path && fs.existsSync(f.path)) {
            try {
              fs.unlinkSync(f.path);
            } catch (unlinkErr) {
              console.error('[UploadCleanup] Error removing invalid file:', unlinkErr);
            }
          }
        }
        return res.status(400).json({
          success: false,
          message: check.error || 'File validation failed: invalid format or corrupted file content.',
        });
      }
    }

    next();
  };
}

/**
 * Specific Multer instances for fine-grained limits
 */
export const uploadAvatar = multer({
  storage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.AVATAR),
  limits: { fileSize: UPLOAD_POLICIES.AVATAR.maxSizeBytes, files: 1 },
});

export const uploadVerificationDoc = multer({
  storage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.VERIFICATION_DOC),
  limits: { fileSize: UPLOAD_POLICIES.VERIFICATION_DOC.maxSizeBytes },
});

export const uploadMedicalRecord = multer({
  storage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.MEDICAL_RECORD),
  limits: { fileSize: UPLOAD_POLICIES.MEDICAL_RECORD.maxSizeBytes, files: 1 },
});

export const uploadConsultationAttachment = multer({
  storage,
  fileFilter: createUploadFilter(UPLOAD_POLICIES.CONSULTATION_FILE),
  limits: { fileSize: UPLOAD_POLICIES.CONSULTATION_FILE.maxSizeBytes, files: 1 },
});

export default upload;
