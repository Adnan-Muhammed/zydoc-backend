// src/infrastructure/utils/fileValidator.js
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Supported File Signatures (Magic Bytes)
 */
export const FILE_SIGNATURES = {
  PDF: {
    mime: 'application/pdf',
    exts: ['.pdf'],
    check: (buf) => buf.length >= 5 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2D, // %PDF-
  },
  JPEG: {
    mime: 'image/jpeg',
    exts: ['.jpg', '.jpeg'],
    check: (buf) => buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,
  },
  PNG: {
    mime: 'image/png',
    exts: ['.png'],
    check: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4E &&
      buf[3] === 0x47 &&
      buf[4] === 0x0D &&
      buf[5] === 0x0A &&
      buf[6] === 0x1A &&
      buf[7] === 0x0A,
  },
  WEBP: {
    mime: 'image/webp',
    exts: ['.webp'],
    check: (buf) =>
      buf.length >= 12 &&
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP',
  },
};

/**
 * Granular Use-Case Validation Policies
 */
export const UPLOAD_POLICIES = {
  AVATAR: {
    allowedTypes: ['JPEG', 'PNG', 'WEBP'],
    maxSizeBytes: 5 * 1024 * 1024, // 5MB
    label: 'Profile Photo (JPEG, PNG, WebP up to 5MB)',
  },
  VERIFICATION_DOC: {
    allowedTypes: ['PDF', 'JPEG', 'PNG'],
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    label: 'Verification Document (PDF, JPEG, PNG up to 10MB)',
  },
  QUALIFICATION: {
    allowedTypes: ['PDF', 'JPEG', 'PNG'],
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    label: 'Qualification Certificate (PDF, JPEG, PNG up to 10MB)',
  },
  MEDICAL_RECORD: {
    allowedTypes: ['PDF', 'JPEG', 'PNG'],
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    label: 'Medical Record (PDF, JPEG, PNG up to 10MB)',
  },
  CONSULTATION_FILE: {
    allowedTypes: ['PDF', 'JPEG', 'PNG', 'WEBP'],
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    label: 'Consultation Attachment (PDF, JPEG, PNG, WebP up to 10MB)',
  },
};

/**
 * Detect file format from raw buffer using magic bytes
 * @param {Buffer} buffer
 * @returns {string|null} Key in FILE_SIGNATURES ('PDF', 'JPEG', 'PNG', 'WEBP') or null
 */
export function detectFileSignature(buffer) {
  if (!buffer || buffer.length < 4) return null;
  for (const [key, sig] of Object.entries(FILE_SIGNATURES)) {
    if (sig.check(buffer)) {
      return key;
    }
  }
  return null;
}

/**
 * Validate that an uploaded file matches its policy by extension, MIME, and magic bytes
 * @param {object} file - Multer file object
 * @param {object} policy - UPLOAD_POLICIES entry
 * @returns {{ valid: boolean, error?: string, detectedType?: string }}
 */
export function validateFileContent(file, policy) {
  if (!file) {
    return { valid: false, error: 'No file provided.' };
  }

  // 1. File Size Check
  const size = file.size ?? (file.buffer ? file.buffer.length : 0);
  if (size > policy.maxSizeBytes) {
    const maxMb = policy.maxSizeBytes / (1024 * 1024);
    return { valid: false, error: `File size exceeds the allowed limit of ${maxMb}MB.` };
  }

  // 2. Extension Check
  const ext = path.extname(file.originalname || '').toLowerCase();
  const allowedExts = policy.allowedTypes.flatMap((t) => FILE_SIGNATURES[t].exts);
  if (!allowedExts.includes(ext)) {
    return {
      valid: false,
      error: `Invalid file extension "${ext}". Allowed: ${allowedExts.join(', ')}.`,
    };
  }

  // 3. MIME Type Check against reported MIME
  const allowedMimes = policy.allowedTypes.map((t) => FILE_SIGNATURES[t].mime);
  if (file.mimetype && !allowedMimes.includes(file.mimetype.toLowerCase())) {
    return {
      valid: false,
      error: `Invalid MIME type "${file.mimetype}". Allowed: ${allowedMimes.join(', ')}.`,
    };
  }

  // 4. Magic Bytes Inspection (Read buffer from memory or read first 32 bytes from disk)
  let headerBuf;
  if (file.buffer) {
    headerBuf = file.buffer.subarray(0, 32);
  } else if (file.path && fs.existsSync(file.path)) {
    const fd = fs.openSync(file.path, 'r');
    try {
      headerBuf = Buffer.alloc(32);
      fs.readSync(fd, headerBuf, 0, 32, 0);
    } finally {
      fs.closeSync(fd);
    }
  }

  if (headerBuf) {
    const detectedType = detectFileSignature(headerBuf);
    if (!detectedType || !policy.allowedTypes.includes(detectedType)) {
      return {
        valid: false,
        error: `File signature mismatch. The file content does not match permitted formats (${policy.allowedTypes.join(', ')}).`,
      };
    }

    // Ensure detected magic bytes align with the file extension
    const sigInfo = FILE_SIGNATURES[detectedType];
    if (!sigInfo.exts.includes(ext)) {
      return {
        valid: false,
        error: `File extension "${ext}" conflicts with detected content format "${detectedType}".`,
      };
    }

    return { valid: true, detectedType };
  }

  return { valid: true };
}

/**
 * Generate a cryptographically unguessable, sanitized storage filename
 * @param {string} prefix - e.g. 'avatar', 'rec', 'doc'
 * @param {string} originalName - client-supplied filename (used only for extension)
 * @returns {string} e.g. 'avatar-3b99a6cf-7bf1-477c-8bbd-327c528f8f2b.png'
 */
export function generateSecureFilename(prefix, originalName) {
  const ext = path.extname(originalName || '').toLowerCase() || '.bin';
  // Sanitize extension to only alphanumeric
  const cleanExt = '.' + ext.replace(/[^a-z0-9]/g, '');
  const uniqueId = crypto.randomUUID();
  return `${prefix}-${uniqueId}${cleanExt}`;
}

/**
 * Sanitize a path or filename to prevent directory traversal
 * @param {string} filename
 * @returns {string} basename only
 */
export function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') return '';
  // Strip null bytes and directory separators
  const base = path.basename(filename.replace(/\0/g, ''));
  // Reject parent traversal indicators
  return base.replace(/\.\./g, '');
}
