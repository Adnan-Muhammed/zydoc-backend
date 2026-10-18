// tests/file-security-audit.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

// Utilities & Services under audit
import {
  detectFileSignature,
  validateFileContent,
  generateSecureFilename,
  sanitizeFilename,
  UPLOAD_POLICIES,
} from "../src/infrastructure/utils/fileValidator.js";

import {
  verifyUploadSignatures,
  safeCleanupFiles,
  uploadValidatedFileToS3,
} from "../src/presentation/middleware/uploadMiddleware.js";
import { secureFileController } from "../src/presentation/controllers/SecureFileController.js";
import { DeleteMedicalRecord } from "../src/application/usecases/patient/DeleteMedicalRecord.js";
import { AddMedicalRecord } from "../src/application/usecases/patient/AddMedicalRecord.js";
import { UpdatePatientProfile } from "../src/application/usecases/patient/UpdatePatientProfile.js";
import { UpdateDoctorProfile } from "../src/application/usecases/doctor/UpdateDoctorProfile.js";
import { uploadConsultationFile, disputeAppointment } from "../src/presentation/controllers/AppointmentController.js";
import { s3StorageService } from "../src/infrastructure/services/S3StorageService.js";
import { validateDoctorAvatar } from "../src/presentation/routes/doctorRoutes.js";

// Models for stubbing/testing
import Doctor from "../src/infrastructure/database/models/DoctorProfile.js";
import Patient from "../src/infrastructure/database/models/PatientProfile.js";
import SharedUser from "../src/infrastructure/database/models/SharedUser.js";
import MedicalRecord from "../src/infrastructure/database/models/MedicalRecord.js";
import Appointment from "../src/infrastructure/database/models/Appointment.js";
import ConsultationRecord from "../src/infrastructure/database/models/ConsultationRecord.js";
import RefundTicket from "../src/infrastructure/database/models/RefundTicket.js";
import Admin from "../src/infrastructure/database/models/AdminProfile.js";

import stream from "stream";
const TEST_SECRET = "audit_test_jwt_secret_987654";
process.env.JWT_SECRET = TEST_SECRET;

// Helper to create mock response that supports stream piping
function createMockRes() {
  const res = new stream.PassThrough();
  res.statusCode = 200;
  res.headers = {};
  res.body = null;
  res.redirectUrl = null;
  res.status = function(code) {
    this.statusCode = code;
    return this;
  };
  res.json = function(data) {
    this.body = data;
    return this;
  };
  res.setHeader = function(key, val) {
    this.headers[key] = val;
    return this;
  };
  res.redirect = function(code, url) {
    if (typeof code === "string") {
      url = code;
      code = 302;
    }
    this.statusCode = code;
    this.redirectUrl = url;
    return this;
  };
  return res;
}

// Byte sequences for tests
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_HEADER = Buffer.from("%PDF-1.5\n%fake pdf content for security testing\n%%EOF");
const WEBP_HEADER = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 "),
]);
const MP4_HEADER = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
const MALICIOUS_SCRIPT = Buffer.from("<html><script>alert('xss')</script></html>");

describe("1. Strict File Type, Signature (Magic Bytes) & Policy Validation", () => {
  it("allows authentic JPEG, PNG, PDF, and WebP files with matching signatures", () => {
    assert.equal(detectFileSignature(JPEG_HEADER), "JPEG");
    assert.equal(detectFileSignature(PNG_HEADER), "PNG");
    assert.equal(detectFileSignature(PDF_HEADER), "PDF");
    assert.equal(detectFileSignature(WEBP_HEADER), "WEBP");

    const validJpg = validateFileContent(
      { buffer: JPEG_HEADER, originalname: "test.jpg", mimetype: "image/jpeg", size: JPEG_HEADER.length },
      UPLOAD_POLICIES.AVATAR
    );
    assert.equal(validJpg.valid, true);

    const validPdf = validateFileContent(
      { buffer: PDF_HEADER, originalname: "report.pdf", mimetype: "application/pdf", size: PDF_HEADER.length },
      UPLOAD_POLICIES.MEDICAL_RECORD
    );
    assert.equal(validPdf.valid, true);
  });

  it("detects and rejects MIME type spoofing (e.g. HTML/JS payload disguised as image/jpeg)", () => {
    const spoofed = validateFileContent(
      { buffer: MALICIOUS_SCRIPT, originalname: "photo.jpg", mimetype: "image/jpeg", size: MALICIOUS_SCRIPT.length },
      UPLOAD_POLICIES.AVATAR
    );
    assert.equal(spoofed.valid, false);
    assert.match(spoofed.error, /File signature mismatch/i);
  });

  it("detects and rejects signature mismatches (e.g. PDF renamed to .png)", () => {
    const mismatched = validateFileContent(
      { buffer: PDF_HEADER, originalname: "avatar.png", mimetype: "image/png", size: PDF_HEADER.length },
      UPLOAD_POLICIES.AVATAR
    );
    assert.equal(mismatched.valid, false);
    assert.match(mismatched.error, /signature mismatch/i);
  });

  it("rejects unsupported video and audio files across all medical and avatar policies", () => {
    const video = validateFileContent(
      { buffer: MP4_HEADER, originalname: "clip.mp4", mimetype: "video/mp4", size: MP4_HEADER.length },
      UPLOAD_POLICIES.MEDICAL_RECORD
    );
    assert.equal(video.valid, false);
    assert.match(video.error, /Invalid file extension "\.mp4"/i);
  });

  it("strictly enforces maximum file size limits per policy", () => {
    const largeBuffer = Buffer.concat([JPEG_HEADER, Buffer.alloc(UPLOAD_POLICIES.AVATAR.maxSizeBytes + 1024)]);
    const oversized = validateFileContent(
      { buffer: largeBuffer, originalname: "big.jpg", mimetype: "image/jpeg", size: largeBuffer.length },
      UPLOAD_POLICIES.AVATAR
    );
    assert.equal(oversized.valid, false);
    assert.match(oversized.error, /exceeds the allowed limit/i);
  });

  it("sanitizes filenames to prevent path traversal characters", () => {
    const traversed = sanitizeFilename("../../../etc/shadow.jpg");
    assert.equal(traversed.includes(".."), false);
    assert.equal(traversed.includes("/"), false);
    assert.equal(traversed, "shadow.jpg");
  });

  it("generates unguessable, collision-free UUID filenames", () => {
    const name1 = generateSecureFilename("rec", "patient-report.pdf");
    const name2 = generateSecureFilename("rec", "patient-report.pdf");
    assert.notEqual(name1, name2);
    assert.match(name1, /^rec-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i);
  });

  it("strictly rejects 0-byte empty files", () => {
    const emptyFile = validateFileContent(
      { buffer: Buffer.alloc(0), originalname: "empty.pdf", mimetype: "application/pdf", size: 0 },
      UPLOAD_POLICIES.MEDICAL_RECORD
    );
    assert.equal(emptyFile.valid, false);
    assert.match(emptyFile.error, /empty/i);
  });

  it("strictly rejects files missing both buffer and accessible path", () => {
    const missingContent = validateFileContent(
      { originalname: "report.pdf", mimetype: "application/pdf", size: 100 },
      UPLOAD_POLICIES.MEDICAL_RECORD
    );
    assert.equal(missingContent.valid, false);
    assert.match(missingContent.error, /buffer or accessible path required/i);
  });
});

describe("2. Upload Middleware Signature Verification & Immediate Unlink of Invalid Files", () => {
  const tempDir = path.resolve("uploads");
  const tempCorruptFile = path.resolve(tempDir, "temp-test-corrupt.jpg");
  const tempValidFile = path.resolve(tempDir, "temp-test-valid.pdf");

  beforeEach(() => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempCorruptFile)) fs.unlinkSync(tempCorruptFile);
    if (fs.existsSync(tempValidFile)) fs.unlinkSync(tempValidFile);
  });

  it("immediately deletes rejected/corrupt file from disk and returns HTTP 400", () => {
    // Write fake JPEG containing HTML payload
    fs.writeFileSync(tempCorruptFile, MALICIOUS_SCRIPT);
    assert.equal(fs.existsSync(tempCorruptFile), true);

    const req = {
      file: {
        path: tempCorruptFile,
        originalname: "test.jpg",
        mimetype: "image/jpeg",
        size: MALICIOUS_SCRIPT.length,
      },
    };
    const res = createMockRes();
    let nextCalled = false;

    const middleware = verifyUploadSignatures(UPLOAD_POLICIES.AVATAR);
    middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    // Crucial: File MUST be unlinked from disk immediately
    assert.equal(fs.existsSync(tempCorruptFile), false, "Corrupt file was not deleted from uploads directory!");
  });

  it("allows authentic file to pass and retains file on disk", () => {
    fs.writeFileSync(tempValidFile, PDF_HEADER);
    assert.equal(fs.existsSync(tempValidFile), true);

    const req = {
      file: {
        path: tempValidFile,
        originalname: "lab-report.pdf",
        mimetype: "application/pdf",
        size: PDF_HEADER.length,
      },
    };
    const res = createMockRes();
    let nextCalled = false;

    const middleware = verifyUploadSignatures(UPLOAD_POLICIES.MEDICAL_RECORD);
    middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(fs.existsSync(tempValidFile), true);
  });

  it("allows authentic in-memory buffer to pass without requiring disk path", () => {
    const req = {
      file: {
        buffer: PDF_HEADER,
        originalname: "lab-report.pdf",
        mimetype: "application/pdf",
        size: PDF_HEADER.length,
      },
    };
    const res = createMockRes();
    let nextCalled = false;

    const middleware = verifyUploadSignatures(UPLOAD_POLICIES.MEDICAL_RECORD);
    middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
  });

  it("rejects corrupt in-memory buffer with 400 and safeCleanupFiles handles undefined path safely", () => {
    const req = {
      file: {
        buffer: MALICIOUS_SCRIPT,
        originalname: "avatar.jpg",
        mimetype: "image/jpeg",
        size: MALICIOUS_SCRIPT.length,
      },
    };
    const res = createMockRes();
    let nextCalled = false;

    const middleware = verifyUploadSignatures(UPLOAD_POLICIES.AVATAR);
    middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /signature mismatch/i);
  });

  it("safeCleanupFiles safely handles null, undefined, objects without path, and disk files", () => {
    assert.doesNotThrow(() => safeCleanupFiles(null));
    assert.doesNotThrow(() => safeCleanupFiles(undefined));
    assert.doesNotThrow(() => safeCleanupFiles({ buffer: Buffer.from("in-memory-data") }));

    const tempFileForCleanup = path.resolve("uploads", "temp-cleanup-test.txt");
    fs.writeFileSync(tempFileForCleanup, "temp file to be unlinked");
    assert.equal(fs.existsSync(tempFileForCleanup), true);

    safeCleanupFiles({ path: tempFileForCleanup });
    assert.equal(fs.existsSync(tempFileForCleanup), false);
  });
});

describe("2b. S3 Upload Pre-validation & Disk Cleanup Bridge (uploadValidatedFileToS3)", () => {
  const tempDir = path.resolve("uploads");
  const tempBridgeDiskFile = path.resolve(tempDir, "temp-bridge-disk-file.pdf");

  afterEach(() => {
    if (fs.existsSync(tempBridgeDiskFile)) fs.unlinkSync(tempBridgeDiskFile);
  });

  function createMockStorageService() {
    const uploads = [];
    return {
      uploads,
      upload: async (params) => {
        uploads.push(params);
        return {
          key: `mock-${params.prefix || "file"}-123.bin`,
          bucket: params.bucketType === "public" ? "mock-public-bucket" : "mock-private-bucket",
          bucketType: params.bucketType,
          url: params.bucketType === "public" ? `https://mock.cloudfront.net/mock-${params.prefix || "file"}-123.bin` : null,
        };
      },
    };
  }

  it("successfully validates and uploads memory buffer to S3 via storage service", async () => {
    const mockStorage = createMockStorageService();
    const file = {
      buffer: JPEG_HEADER,
      originalname: "doctor-photo.jpg",
      mimetype: "image/jpeg",
      size: JPEG_HEADER.length,
    };

    const result = await uploadValidatedFileToS3(file, {
      bucketType: "public",
      prefix: "avatar",
      storageService: mockStorage,
    });

    assert.equal(mockStorage.uploads.length, 1);
    assert.equal(mockStorage.uploads[0].bucketType, "public");
    assert.equal(mockStorage.uploads[0].prefix, "avatar");
    assert.equal(mockStorage.uploads[0].contentType, "image/jpeg");

    assert.equal(file.s3Key, result.key);
    assert.equal(file.s3Bucket, "mock-public-bucket");
    assert.ok(file.s3Url.startsWith("https://mock.cloudfront.net/"));
  });

  it("strictly refuses to upload file to S3 when magic bytes fail validation", async () => {
    const mockStorage = createMockStorageService();
    const corruptFile = {
      buffer: MALICIOUS_SCRIPT,
      originalname: "doctor-photo.jpg",
      mimetype: "image/jpeg",
      size: MALICIOUS_SCRIPT.length,
    };

    await assert.rejects(
      async () => {
        await uploadValidatedFileToS3(corruptFile, {
          bucketType: "public",
          prefix: "avatar",
          storageService: mockStorage,
        });
      },
      /signature mismatch/i
    );

    // CRITICAL: Ensure S3 upload was NEVER called
    assert.equal(mockStorage.uploads.length, 0, "Corrupt file was dispatched to S3!");
  });

  it("uploads temporary disk file to S3 and automatically cleans it up from disk", async () => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(tempBridgeDiskFile, PDF_HEADER);
    assert.equal(fs.existsSync(tempBridgeDiskFile), true);

    const mockStorage = createMockStorageService();
    const file = {
      path: tempBridgeDiskFile,
      originalname: "patient-record.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    const result = await uploadValidatedFileToS3(file, {
      bucketType: "private",
      prefix: "rec",
      storageService: mockStorage,
    });

    assert.equal(mockStorage.uploads.length, 1);
    assert.equal(mockStorage.uploads[0].bucketType, "private");
    assert.equal(result.bucketType, "private");

    // CRITICAL: Disk file must be automatically removed after S3 upload
    assert.equal(fs.existsSync(tempBridgeDiskFile), false, "Temporary disk file was not cleaned up after S3 upload!");
  });

  it("cleans up temporary disk file when S3 upload fails", async () => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(tempBridgeDiskFile, PDF_HEADER);
    assert.equal(fs.existsSync(tempBridgeDiskFile), true);

    const failingStorage = {
      upload: async () => {
        throw new Error("Simulated S3 network failure");
      },
    };

    const file = {
      path: tempBridgeDiskFile,
      originalname: "patient-record.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    await assert.rejects(
      async () => {
        await uploadValidatedFileToS3(file, {
          bucketType: "private",
          prefix: "rec",
          storageService: failingStorage,
        });
      },
      /Simulated S3 network failure/i
    );

    // CRITICAL: Disk file must be unlinked even when S3 upload fails
    assert.equal(fs.existsSync(tempBridgeDiskFile), false, "Temporary disk file was not cleaned up after failed S3 upload!");
  });
});

function chainableQuery(result) {
  const query = {
    select() { return query; },
    populate() { return query; },
    sort() { return query; },
    limit() { return query; },
    lean() { return query; },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
    catch(reject) {
      return Promise.resolve(result).catch(reject);
    },
  };
  return query;
}

describe("3. SecureFileController: Direct-Access Gatekeeping & Isolation", () => {
  let origDoctorFindOne;
  let origAppointmentFindOne;
  let origAppointmentFindById;
  let origAppointmentExists;
  let origPatientFindOne;
  let origSharedUserFindOne;
  let origSharedUserFindById;
  let origConsultationRecordFindOne;
  let origMedicalRecordFindOne;
  let origRefundTicketFindOne;
  let origGetPresignedDownloadUrl;

  beforeEach(() => {
    origDoctorFindOne = Doctor.findOne;
    origAppointmentFindOne = Appointment.findOne;
    origAppointmentFindById = Appointment.findById;
    origAppointmentExists = Appointment.exists;
    origPatientFindOne = Patient.findOne;
    origSharedUserFindOne = SharedUser.findOne;
    origSharedUserFindById = SharedUser.findById;
    origConsultationRecordFindOne = ConsultationRecord.findOne;
    origMedicalRecordFindOne = MedicalRecord.findOne;
    origRefundTicketFindOne = RefundTicket.findOne;
    origGetPresignedDownloadUrl = s3StorageService.getPresignedDownloadUrl.bind(s3StorageService);

    Doctor.findOne = () => chainableQuery(null);
    Appointment.findOne = () => chainableQuery(null);
    Appointment.findById = () => chainableQuery(null);
    Appointment.exists = () => Promise.resolve(false);
    Patient.findOne = () => chainableQuery(null);
    SharedUser.findOne = () => chainableQuery(null);
    SharedUser.findById = () => chainableQuery(null);
    ConsultationRecord.findOne = () => chainableQuery(null);
    MedicalRecord.findOne = () => chainableQuery(null);
    RefundTicket.findOne = () => chainableQuery(null);

    s3StorageService.getPresignedDownloadUrl = async (key, options = {}) => {
      const bucket = options.bucketType === "public" ? "test-public-bucket" : "test-private-bucket";
      return `https://${bucket}.s3.amazonaws.com/${key}?X-Amz-Expires=900&mockSigned=true`;
    };
  });

  afterEach(() => {
    Doctor.findOne = origDoctorFindOne;
    Appointment.findOne = origAppointmentFindOne;
    Appointment.findById = origAppointmentFindById;
    Appointment.exists = origAppointmentExists;
    Patient.findOne = origPatientFindOne;
    SharedUser.findOne = origSharedUserFindOne;
    SharedUser.findById = origSharedUserFindById;
    ConsultationRecord.findOne = origConsultationRecordFindOne;
    MedicalRecord.findOne = origMedicalRecordFindOne;
    RefundTicket.findOne = origRefundTicketFindOne;
    s3StorageService.getPresignedDownloadUrl = origGetPresignedDownloadUrl;
  });

  it("rejects path traversal attacks on /uploads/:filename with 400 or 403", async () => {
    const req = { params: { filename: "../../../server.js" } };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.ok(res.statusCode === 400 || res.statusCode === 403);
    assert.equal(res.body.success, false);
  });

  it("blocks unauthenticated access to private documents with 401 or 404", async () => {
    const req = {
      params: { filename: "private-blood-report.pdf" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.ok([401, 404].includes(res.statusCode));
    assert.equal(res.body.success, false);
  });

  it("enforces Patient-to-Patient isolation on medical records", async () => {
    const patientAId = new mongoose.Types.ObjectId();
    const patientBId = new mongoose.Types.ObjectId();

    MedicalRecord.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientAId,
      fileUrl: "/uploads/record-A.pdf",
    });

    const uploadsDir = path.resolve("uploads");
    const testFile = path.resolve(uploadsDir, "record-A.pdf");
    fs.writeFileSync(testFile, PDF_HEADER);

    try {
      // Patient B requests Patient A's record
      const tokenPatientB = jwt.sign({ id: patientBId.toString(), role: "patient" }, TEST_SECRET);
      const req = {
        params: { filename: "record-A.pdf" },
        cookies: { accessToken: tokenPatientB },
        headers: {},
      };
      const res = createMockRes();

      await secureFileController.getFile(req, res);
      assert.equal(res.statusCode, 403);
      assert.match(res.body.message, /Access denied/i);
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it("enforces Doctor-to-Doctor isolation on private consultation files", async () => {
    const doctorAId = new mongoose.Types.ObjectId();
    const doctorBId = new mongoose.Types.ObjectId();
    const appointmentId = new mongoose.Types.ObjectId();

    Appointment.findOne = () => chainableQuery({
      _id: appointmentId,
      doctorId: doctorAId,
      patientId: new mongoose.Types.ObjectId(),
    });

    SharedUser.findById = () => chainableQuery({
      _id: doctorBId,
      profileId: doctorBId,
    });

    const uploadsDir = path.resolve("uploads");
    const testFile = path.resolve(uploadsDir, "consult-doc.pdf");
    fs.writeFileSync(testFile, PDF_HEADER);

    try {
      // Doctor B requests Doctor A's consultation file
      const tokenDoctorB = jwt.sign({ id: doctorBId.toString(), role: "doctor" }, TEST_SECRET);
      const req = {
        params: { filename: "consult-doc.pdf" },
        cookies: { accessToken: tokenDoctorB },
        headers: {},
      };
      const res = createMockRes();

      await secureFileController.getFile(req, res);
      assert.equal(res.statusCode, 403);
      assert.match(res.body.message, /Access denied/i);
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it("permits approved doctor profile avatar to be viewed publicly without auth", async () => {
    const uploadsDir = path.resolve("uploads");
    const testFile = path.resolve(uploadsDir, "doc-avatar-123.jpg");
    fs.writeFileSync(testFile, JPEG_HEADER);

    Doctor.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      avatarUrl: "/uploads/doc-avatar-123.jpg",
      verificationStatus: "approved",
    });

    try {
      const req = {
        params: { filename: "doc-avatar-123.jpg" },
        headers: {},
        cookies: {},
      };
      const res = createMockRes();

      await secureFileController.getFile(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["Content-Type"], "image/jpeg");

      // Wait for stream pipe to finish reading from disk
      await new Promise((resolve) => {
        res.on("finish", resolve);
        res.on("end", resolve);
        setTimeout(resolve, 50);
      });
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it("redirects approved doctor profile avatar stored as CloudFront URL directly without auth", async () => {
    const cloudFrontAvatarUrl = "https://d2j3r11t01prca.cloudfront.net/avatars/approved-doc-456.jpg";

    Doctor.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      avatarUrl: cloudFrontAvatarUrl,
      verificationStatus: "approved",
    });

    SharedUser.findOne = () => chainableQuery({
      accountStatus: "active",
    });

    const req = {
      params: { filename: "approved-doc-456.jpg" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectUrl, cloudFrontAvatarUrl);
  });

  it("redirects approved doctor profile avatar stored as S3 key to configured CloudFront domain without auth", async () => {
    Doctor.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      avatarUrl: "avatars/s3-approved-doc-789.png",
      verificationStatus: "approved",
    });

    SharedUser.findOne = () => chainableQuery({
      accountStatus: "active",
    });

    const req = {
      params: { filename: "s3-approved-doc-789.png" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.equal(res.redirectUrl, "https://d2j3r11t01prca.cloudfront.net/avatars/s3-approved-doc-789.png");
  });

  it("strictly blocks unauthenticated access to pending doctor profile avatar (401)", async () => {
    Doctor.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      avatarUrl: "/uploads/pending-doc-avatar.jpg",
      verificationStatus: "pending",
    });

    SharedUser.findOne = () => chainableQuery({
      accountStatus: "active",
    });

    const req = {
      params: { filename: "pending-doc-avatar.jpg" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Authentication required/i);
  });

  it("strictly blocks unauthenticated access to rejected doctor profile avatar (401)", async () => {
    Doctor.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      avatarUrl: "/uploads/rejected-doc-avatar.jpg",
      verificationStatus: "rejected",
    });

    SharedUser.findOne = () => chainableQuery({
      accountStatus: "active",
    });

    const req = {
      params: { filename: "rejected-doc-avatar.jpg" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Authentication required/i);
  });

  it("strictly blocks unauthenticated access to suspended doctor profile avatar (401)", async () => {
    Doctor.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      avatarUrl: "/uploads/suspended-doc-avatar.jpg",
      verificationStatus: "approved",
    });

    SharedUser.findOne = () => chainableQuery({
      accountStatus: "suspended",
    });

    const req = {
      params: { filename: "suspended-doc-avatar.jpg" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Authentication required/i);
  });

  it("strictly prevents filename patterns (avatar- / passport) from granting public access to unapproved doctor", async () => {
    // Both avatar- prefix and passport substring tested
    for (const filename of ["avatar-pending-doc.jpg", "passport-photo-pending.jpg"]) {
      Doctor.findOne = () => chainableQuery({
        _id: new mongoose.Types.ObjectId(),
        avatarUrl: `/uploads/${filename}`,
        verificationStatus: "pending",
      });

      SharedUser.findOne = () => chainableQuery({
        accountStatus: "active",
      });

      const req = {
        params: { filename },
        headers: {},
        cookies: {},
      };
      const res = createMockRes();

      await secureFileController.getFile(req, res);
      assert.equal(res.statusCode, 401, `Filename ${filename} erroneously bypassed auth!`);
      assert.equal(res.body.success, false);
    }
  });

  it("blocks unauthorized authenticated users (e.g. random patient) from accessing pending doctor avatar (403)", async () => {
    const doctorProfileId = new mongoose.Types.ObjectId();
    const doctorUserId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    Doctor.findOne = () => chainableQuery({
      _id: doctorProfileId,
      avatarUrl: "/uploads/pending-avatar-secret.jpg",
      verificationStatus: "pending",
    });

    SharedUser.findOne = () => chainableQuery({
      _id: doctorUserId,
      accountStatus: "active",
    });

    const patientToken = jwt.sign({ id: patientUserId.toString(), role: "patient" }, TEST_SECRET);
    const req = {
      params: { filename: "pending-avatar-secret.jpg" },
      cookies: { accessToken: patientToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Access denied/i);
  });

  it("allows admin or the submitting doctor to view pending doctor avatar", async () => {
    const doctorProfileId = new mongoose.Types.ObjectId();
    const doctorUserId = new mongoose.Types.ObjectId();

    const uploadsDir = path.resolve("uploads");
    const testFile = path.resolve(uploadsDir, "pending-avatar-authorized.jpg");
    fs.writeFileSync(testFile, JPEG_HEADER);

    Doctor.findOne = () => chainableQuery({
      _id: doctorProfileId,
      avatarUrl: "/uploads/pending-avatar-authorized.jpg",
      verificationStatus: "pending",
    });

    SharedUser.findOne = () => chainableQuery({
      _id: doctorUserId,
      accountStatus: "active",
    });

    try {
      // 1. Doctor themselves accessing pending avatar
      const docToken = jwt.sign({ id: doctorUserId.toString(), role: "doctor" }, TEST_SECRET);
      const docReq = {
        params: { filename: "pending-avatar-authorized.jpg" },
        cookies: { accessToken: docToken },
        headers: {},
      };
      const docRes = createMockRes();
      await secureFileController.getFile(docReq, docRes);
      assert.equal(docRes.statusCode, 200);

      await new Promise((resolve) => {
        docRes.on("finish", resolve);
        docRes.on("end", resolve);
        setTimeout(resolve, 50);
      });

      // 2. Admin accessing pending avatar
      const adminToken = jwt.sign({ id: "admin_123", role: "admin" }, TEST_SECRET);
      const adminReq = {
        params: { filename: "pending-avatar-authorized.jpg" },
        cookies: { accessToken: adminToken },
        headers: {},
      };
      const adminRes = createMockRes();
      await secureFileController.getFile(adminReq, adminRes);
      assert.equal(adminRes.statusCode, 200);

      await new Promise((resolve) => {
        adminRes.on("finish", resolve);
        adminRes.on("end", resolve);
        setTimeout(resolve, 50);
      });
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it("strictly prevents doctor verification documents from being accessed via public path even if filename starts with avatar-", async () => {
    // Attack scenario: doctor verification doc named "avatar-fake-cert.pdf"
    const fakeDocName = "avatar-fake-cert.pdf";
    const uploadsDir = path.resolve("uploads");
    const testFile = path.resolve(uploadsDir, fakeDocName);
    fs.writeFileSync(testFile, PDF_HEADER);

    Doctor.findOne = (query) => {
      // It is NOT stored as avatarUrl
      if (query?.avatarUrl) return chainableQuery(null);
      // It IS stored as a verification document
      if (query?.$or) {
        return chainableQuery({
          _id: new mongoose.Types.ObjectId(),
          medicalCertificateUrl: `/uploads/${fakeDocName}`,
        });
      }
      return chainableQuery(null);
    };

    try {
      // Unauthenticated request must receive 401, NOT public 200
      const unauthReq = {
        params: { filename: fakeDocName },
        headers: {},
        cookies: {},
      };
      const unauthRes = createMockRes();
      await secureFileController.getFile(unauthReq, unauthRes);
      assert.equal(unauthRes.statusCode, 401, "Verification document was served publicly without auth!");

      // Random patient request must receive 403 Access Denied
      const patientToken = jwt.sign({ id: "random_patient", role: "patient" }, TEST_SECRET);
      const patientReq = {
        params: { filename: fakeDocName },
        cookies: { accessToken: patientToken },
        headers: {},
      };
      const patientRes = createMockRes();
      await secureFileController.getFile(patientReq, patientRes);
      assert.equal(patientRes.statusCode, 403, "Verification document was served to unauthorized patient!");
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it("allows Admin to view doctor verification credentials but blocks unapproved users", async () => {
    const uploadsDir = path.resolve("uploads");
    const testFile = path.resolve(uploadsDir, "doc-cert-123.pdf");
    fs.writeFileSync(testFile, PDF_HEADER);

    Doctor.findOne = (query) => {
      if (query?.avatarUrl) return chainableQuery(null);
      if (query?.$or) {
        return chainableQuery({
          _id: new mongoose.Types.ObjectId(),
          medicalCertificateUrl: "/uploads/doc-cert-123.pdf",
        });
      }
      return chainableQuery(null);
    };

    try {
      // 1. Admin accessing certificate
      const adminToken = jwt.sign({ id: "admin_123", role: "admin" }, TEST_SECRET);
      const adminReq = {
        params: { filename: "doc-cert-123.pdf" },
        cookies: { accessToken: adminToken },
        headers: {},
      };
      const adminRes = createMockRes();
      await secureFileController.getFile(adminReq, adminRes);
      assert.equal(adminRes.statusCode, 200);
      assert.equal(adminRes.headers["Content-Type"], "application/pdf");

      await new Promise((resolve) => {
        adminRes.on("finish", resolve);
        adminRes.on("end", resolve);
        setTimeout(resolve, 50);
      });

      // 2. Random patient attempting to view doctor verification certificate
      const patientToken = jwt.sign({ id: "patient_999", role: "patient" }, TEST_SECRET);
      const patientReq = {
        params: { filename: "doc-cert-123.pdf" },
        cookies: { accessToken: patientToken },
        headers: {},
      };
      const patientRes = createMockRes();
      await secureFileController.getFile(patientReq, patientRes);
      assert.equal(patientRes.statusCode, 403);
      assert.match(patientRes.body.message, /Access denied/i);
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it("serves private doctor verification document in S3 via 900-second presigned URL to submitting doctor", async () => {
    const doctorProfileId = new mongoose.Types.ObjectId();
    const doctorUserId = new mongoose.Types.ObjectId();

    Doctor.findOne = () => chainableQuery({
      _id: doctorProfileId,
      medicalCertificateUrl: "medical-certificates/medcert-private-123.pdf",
    });

    SharedUser.findOne = () => chainableQuery({
      _id: doctorUserId,
      profileId: doctorProfileId,
      role: "doctor",
    });

    const docToken = jwt.sign({ id: doctorUserId.toString(), role: "doctor" }, TEST_SECRET);
    const req = {
      params: { filename: "medcert-private-123.pdf" },
      cookies: { accessToken: docToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
    assert.ok(res.redirectUrl.includes("medcert-private-123.pdf"));
  });

  it("serves private doctor verification document in S3 via 900-second presigned URL to admin", async () => {
    const doctorProfileId = new mongoose.Types.ObjectId();

    Doctor.findOne = () => chainableQuery({
      _id: doctorProfileId,
      governmentIdUrl: "government-ids/govid-private-456.pdf",
    });

    const adminToken = jwt.sign({ id: "admin_user_id", role: "admin" }, TEST_SECRET);
    const req = {
      params: { filename: "govid-private-456.pdf" },
      cookies: { accessToken: adminToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
  });

  it("strictly blocks a different doctor from accessing doctor verification documents in S3 (403)", async () => {
    const doctorAProfileId = new mongoose.Types.ObjectId();
    const doctorAUserId = new mongoose.Types.ObjectId();
    const doctorBUserId = new mongoose.Types.ObjectId();

    Doctor.findOne = () => chainableQuery({
      _id: doctorAProfileId,
      medicalCertificateUrl: "medical-certificates/docA-medcert.pdf",
    });

    SharedUser.findOne = () => chainableQuery({
      _id: doctorAUserId,
      profileId: doctorAProfileId,
      role: "doctor",
    });

    // Doctor B tries to access Doctor A's verification document
    const doctorBToken = jwt.sign({ id: doctorBUserId.toString(), role: "doctor" }, TEST_SECRET);
    const req = {
      params: { filename: "docA-medcert.pdf" },
      cookies: { accessToken: doctorBToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Access denied/i);
  });

  it("serves patient avatar in private S3 via 900-second presigned URL to owner patient", async () => {
    const patientProfileId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    Patient.findOne = () => chainableQuery({
      _id: patientProfileId,
      avatarUrl: "patient-avatars/patient-private-avatar.jpg",
    });

    SharedUser.findOne = () => chainableQuery({
      _id: patientUserId,
      profileId: patientProfileId,
    });

    const patientToken = jwt.sign({ id: patientUserId.toString(), role: "patient" }, TEST_SECRET);
    const req = {
      params: { filename: "patient-private-avatar.jpg" },
      cookies: { accessToken: patientToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
    assert.ok(!res.redirectUrl.includes("cloudfront.net"), "Patient avatar was exposed via CloudFront!");
  });

  it("serves patient avatar in private S3 via 900-second presigned URL to attending doctor", async () => {
    const patientProfileId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();
    const doctorUserId = new mongoose.Types.ObjectId();
    const doctorProfileId = new mongoose.Types.ObjectId();

    Patient.findOne = () => chainableQuery({
      _id: patientProfileId,
      avatarUrl: "patient-avatars/patient-private-avatar.jpg",
    });

    SharedUser.findOne = () => chainableQuery({
      _id: patientUserId,
      profileId: patientProfileId,
    });

    SharedUser.findById = () => chainableQuery({
      _id: doctorUserId,
      profileId: doctorProfileId,
    });

    Appointment.exists = () => Promise.resolve(true);

    const doctorToken = jwt.sign({ id: doctorUserId.toString(), role: "doctor" }, TEST_SECRET);
    const req = {
      params: { filename: "patient-private-avatar.jpg" },
      cookies: { accessToken: doctorToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
  });

  it("strictly blocks a different patient from accessing another patient's private avatar in S3 (403)", async () => {
    const patientAProfileId = new mongoose.Types.ObjectId();
    const patientAUserId = new mongoose.Types.ObjectId();
    const patientBUserId = new mongoose.Types.ObjectId();

    Patient.findOne = () => chainableQuery({
      _id: patientAProfileId,
      avatarUrl: "patient-avatars/patientA-avatar.png",
    });

    SharedUser.findOne = () => chainableQuery({
      _id: patientAUserId,
      profileId: patientAProfileId,
    });

    const patientBToken = jwt.sign({ id: patientBUserId.toString(), role: "patient" }, TEST_SECRET);
    const req = {
      params: { filename: "patientA-avatar.png" },
      cookies: { accessToken: patientBToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Access denied/i);
  });

  it("strictly blocks unauthenticated access to patient avatar in private S3 (401)", async () => {
    Patient.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      avatarUrl: "patient-avatars/patient-avatar.png",
    });

    const req = {
      params: { filename: "patient-avatar.png" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Authentication required/i);
  });

  it("serves private patient medical record in S3 via 900-second presigned URL to owner patient", async () => {
    const patientUserId = new mongoose.Types.ObjectId();

    MedicalRecord.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientUserId,
      fileUrl: "medical-records/medrec-test-123.pdf",
    });

    const patientToken = jwt.sign({ id: patientUserId.toString(), role: "patient" }, TEST_SECRET);
    const req = {
      params: { filename: "medrec-test-123.pdf" },
      cookies: { accessToken: patientToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
    assert.ok(!res.redirectUrl.includes("cloudfront.net"), "Private medical record was exposed via CloudFront!");
  });

  it("serves private patient medical record in S3 via 900-second presigned URL to authorized attending doctor", async () => {
    const patientUserId = new mongoose.Types.ObjectId();
    const doctorUserId = new mongoose.Types.ObjectId();
    const doctorProfileId = new mongoose.Types.ObjectId();

    MedicalRecord.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientUserId,
      fileUrl: "medical-records/medrec-test-123.pdf",
    });

    SharedUser.findById = () => chainableQuery({
      _id: doctorUserId,
      profileId: doctorProfileId,
    });

    Appointment.exists = () => Promise.resolve(true);

    const docToken = jwt.sign({ id: doctorUserId.toString(), role: "doctor" }, TEST_SECRET);
    const req = {
      params: { filename: "medrec-test-123.pdf" },
      cookies: { accessToken: docToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
  });

  it("strictly blocks unauthorized doctor from accessing private patient medical record in S3 (403)", async () => {
    const patientUserId = new mongoose.Types.ObjectId();
    const doctorUserId = new mongoose.Types.ObjectId();

    MedicalRecord.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientUserId,
      fileUrl: "medical-records/medrec-test-123.pdf",
    });

    SharedUser.findById = () => chainableQuery({
      _id: doctorUserId,
      profileId: new mongoose.Types.ObjectId(),
    });

    Appointment.exists = () => Promise.resolve(false); // No active appointment

    const docToken = jwt.sign({ id: doctorUserId.toString(), role: "doctor" }, TEST_SECRET);
    const req = {
      params: { filename: "medrec-test-123.pdf" },
      cookies: { accessToken: docToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Access denied/i);
  });

  it("strictly blocks different patient from accessing private patient medical record in S3 (403)", async () => {
    const patientAId = new mongoose.Types.ObjectId();
    const patientBId = new mongoose.Types.ObjectId();

    MedicalRecord.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientAId,
      fileUrl: "medical-records/medrec-test-123.pdf",
    });

    const patientBToken = jwt.sign({ id: patientBId.toString(), role: "patient" }, TEST_SECRET);
    const req = {
      params: { filename: "medrec-test-123.pdf" },
      cookies: { accessToken: patientBToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Access denied/i);
  });

  it("serves private consultation file in S3 via 900-second presigned URL to assigned patient", async () => {
    const patientUserId = new mongoose.Types.ObjectId();
    const doctorProfileId = new mongoose.Types.ObjectId();

    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      doctorId: doctorProfileId,
      patientId: patientUserId,
      consultationFiles: [{
        name: "consult-report.pdf",
        url: "consultations/consult-report-123.pdf",
      }],
    });

    const patientToken = jwt.sign({ id: patientUserId.toString(), role: "patient" }, TEST_SECRET);
    const req = {
      params: { filename: "consult-report-123.pdf" },
      cookies: { accessToken: patientToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
    assert.ok(!res.redirectUrl.includes("cloudfront.net"));
  });

  it("serves private consultation file in S3 via 900-second presigned URL to assigned doctor", async () => {
    const doctorUserId = new mongoose.Types.ObjectId();
    const doctorProfileId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      doctorId: doctorProfileId,
      patientId: patientUserId,
      consultationFiles: [{
        name: "consult-report.pdf",
        url: "consultations/consult-report-123.pdf",
      }],
    });

    SharedUser.findById = () => chainableQuery({
      _id: doctorUserId,
      profileId: doctorProfileId,
    });

    const docToken = jwt.sign({ id: doctorUserId.toString(), role: "doctor" }, TEST_SECRET);
    const req = {
      params: { filename: "consult-report-123.pdf" },
      cookies: { accessToken: docToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
  });

  it("strictly blocks unauthorized doctor from accessing private consultation file in S3 (403)", async () => {
    const doctorAProfileId = new mongoose.Types.ObjectId();
    const doctorBUserId = new mongoose.Types.ObjectId();
    const doctorBProfileId = new mongoose.Types.ObjectId();

    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      doctorId: doctorAProfileId,
      patientId: new mongoose.Types.ObjectId(),
      consultationFiles: [{
        name: "consult-report.pdf",
        url: "consultations/consult-report-123.pdf",
      }],
    });

    SharedUser.findById = () => chainableQuery({
      _id: doctorBUserId,
      profileId: doctorBProfileId,
    });

    const docBToken = jwt.sign({ id: doctorBUserId.toString(), role: "doctor" }, TEST_SECRET);
    const req = {
      params: { filename: "consult-report-123.pdf" },
      cookies: { accessToken: docBToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Access denied/i);
  });

  it("strictly blocks unauthenticated access to private consultation file in S3 (401)", async () => {
    const req = {
      params: { filename: "consult-report-123.pdf" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Authentication required/i);
  });

  it("serves dispute proof from Appointment.disputeProofUrl in S3 via 900-second presigned URL to submitter patient", async () => {
    const patientUserId = new mongoose.Types.ObjectId();
    const doctorProfileId = new mongoose.Types.ObjectId();

    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientUserId,
      doctorId: doctorProfileId,
      disputeProofUrl: "dispute-proofs/dispute-proof-1.pdf",
    });

    const patientToken = jwt.sign({ id: patientUserId.toString(), role: "patient" }, TEST_SECRET);
    const req = {
      params: { filename: "dispute-proof-1.pdf" },
      cookies: { accessToken: patientToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
    assert.ok(!res.redirectUrl.includes("cloudfront.net"), "Dispute proof was leaked via CloudFront!");
  });

  it("serves dispute proof from RefundTicket.proofUrl in S3 via 900-second presigned URL to submitter patient", async () => {
    const patientUserId = new mongoose.Types.ObjectId();
    const doctorProfileId = new mongoose.Types.ObjectId();

    RefundTicket.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientUserId,
      doctorId: doctorProfileId,
      proofUrl: "dispute-proofs/refund-proof-2.pdf",
    });

    const patientToken = jwt.sign({ id: patientUserId.toString(), role: "patient" }, TEST_SECRET);
    const req = {
      params: { filename: "refund-proof-2.pdf" },
      cookies: { accessToken: patientToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
  });

  it("serves dispute proof in S3 via 900-second presigned URL to assigned doctor", async () => {
    const doctorUserId = new mongoose.Types.ObjectId();
    const doctorProfileId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientUserId,
      doctorId: doctorProfileId,
      disputeProofUrl: "dispute-proofs/dispute-proof-1.pdf",
    });

    SharedUser.findById = () => chainableQuery({
      _id: doctorUserId,
      profileId: doctorProfileId,
    });

    const docToken = jwt.sign({ id: doctorUserId.toString(), role: "doctor" }, TEST_SECRET);
    const req = {
      params: { filename: "dispute-proof-1.pdf" },
      cookies: { accessToken: docToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("X-Amz-Expires=900"));
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
  });

  it("serves dispute proof in S3 via 900-second presigned URL to authorized admin", async () => {
    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: new mongoose.Types.ObjectId(),
      doctorId: new mongoose.Types.ObjectId(),
      disputeProofUrl: "dispute-proofs/dispute-proof-1.pdf",
    });

    const adminToken = jwt.sign({ id: "admin_user_id", role: "admin" }, TEST_SECRET);
    const req = {
      params: { filename: "dispute-proof-1.pdf" },
      cookies: { accessToken: adminToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 302);
    assert.ok(res.redirectUrl.includes("test-private-bucket"));
  });

  it("strictly blocks unrelated patient from accessing dispute proof in S3 (403)", async () => {
    const patientAId = new mongoose.Types.ObjectId();
    const patientBId = new mongoose.Types.ObjectId();

    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientAId,
      doctorId: new mongoose.Types.ObjectId(),
      disputeProofUrl: "dispute-proofs/dispute-proof-1.pdf",
    });

    const patientBToken = jwt.sign({ id: patientBId.toString(), role: "patient" }, TEST_SECRET);
    const req = {
      params: { filename: "dispute-proof-1.pdf" },
      cookies: { accessToken: patientBToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Access denied/i);
  });

  it("strictly blocks unrelated doctor from accessing dispute proof in S3 (403)", async () => {
    const doctorAProfileId = new mongoose.Types.ObjectId();
    const doctorBUserId = new mongoose.Types.ObjectId();
    const doctorBProfileId = new mongoose.Types.ObjectId();

    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: new mongoose.Types.ObjectId(),
      doctorId: doctorAProfileId,
      disputeProofUrl: "dispute-proofs/dispute-proof-1.pdf",
    });

    SharedUser.findById = () => chainableQuery({
      _id: doctorBUserId,
      profileId: doctorBProfileId,
    });

    const docBToken = jwt.sign({ id: doctorBUserId.toString(), role: "doctor" }, TEST_SECRET);
    const req = {
      params: { filename: "dispute-proof-1.pdf" },
      cookies: { accessToken: docBToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Access denied/i);
  });

  it("strictly blocks unauthenticated access to dispute proof in S3 (401)", async () => {
    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: new mongoose.Types.ObjectId(),
      doctorId: new mongoose.Types.ObjectId(),
      disputeProofUrl: "dispute-proofs/dispute-proof-1.pdf",
    });

    const req = {
      params: { filename: "dispute-proof-1.pdf" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Authentication required/i);
  });

  it("serves legacy local /uploads/... dispute proof to authorized patient", async () => {
    const patientUserId = new mongoose.Types.ObjectId();
    const uploadsDir = path.resolve("uploads");
    const testFile = path.resolve(uploadsDir, "legacy-dispute-test.pdf");
    fs.writeFileSync(testFile, PDF_HEADER);

    Appointment.findOne = () => chainableQuery({
      _id: new mongoose.Types.ObjectId(),
      patientId: patientUserId,
      doctorId: new mongoose.Types.ObjectId(),
      disputeProofUrl: "/uploads/legacy-dispute-test.pdf",
    });

    try {
      const patientToken = jwt.sign({ id: patientUserId.toString(), role: "patient" }, TEST_SECRET);
      const req = {
        params: { filename: "legacy-dispute-test.pdf" },
        cookies: { accessToken: patientToken },
        headers: {},
      };
      const res = createMockRes();

      await secureFileController.getFile(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["Content-Type"], "application/pdf");

      await new Promise((resolve) => {
        res.on("finish", resolve);
        res.on("end", resolve);
        setTimeout(resolve, 50);
      });
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it("strictly prevents substring filename collision (requesting report.pdf does not resolve special-report.pdf)", async () => {
    const patientUserId = new mongoose.Types.ObjectId();

    // Patient has record named "special-report.pdf"
    MedicalRecord.findOne = (query) => {
      const reg = query?.fileUrl?.$regex;
      const targetUrl = "medical-records/medrec-special-report.pdf";
      const matches = typeof reg === "string" ? new RegExp(reg).test(targetUrl) : reg?.test ? reg.test(targetUrl) : false;
      if (matches) {
        return chainableQuery({
          _id: new mongoose.Types.ObjectId(),
          patientId: patientUserId,
          fileUrl: targetUrl,
        });
      }
      return chainableQuery(null);
    };

    const patientToken = jwt.sign({ id: patientUserId.toString(), role: "patient" }, TEST_SECRET);
    // User requests "report.pdf" (which is a substring of "special-report.pdf")
    const req = {
      params: { filename: "report.pdf" },
      cookies: { accessToken: patientToken },
      headers: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    // Must return 404 Not Found, NOT match special-report.pdf
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
  });

  it("strictly prevents extension suffix collision (requesting avatar.jpg does not resolve avatar.jpg.bak)", async () => {
    Doctor.findOne = (query) => {
      const reg = query?.avatarUrl?.$regex;
      const targetUrl = "avatars/avatar-123.jpg.bak";
      const matches = typeof reg === "string" ? new RegExp(reg).test(targetUrl) : reg?.test ? reg.test(targetUrl) : false;
      if (matches) {
        return chainableQuery({
          _id: new mongoose.Types.ObjectId(),
          avatarUrl: targetUrl,
          verificationStatus: "approved",
        });
      }
      return chainableQuery(null);
    };

    const req = {
      params: { filename: "avatar-123.jpg" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 401); // Falls through to require auth and 404s
  });
});

describe("4. DeleteMedicalRecord: Safe Cleanup & Physical Unlink", () => {
  it("enforces patient ownership and safely unlinks physical file from disk", async () => {
    const patientId = new mongoose.Types.ObjectId().toString();
    const recordId = new mongoose.Types.ObjectId().toString();
    const fileName = `test-delete-${Date.now()}.pdf`;
    const uploadsDir = path.resolve("uploads");
    const testFile = path.resolve(uploadsDir, fileName);

    fs.writeFileSync(testFile, PDF_HEADER);
    assert.equal(fs.existsSync(testFile), true);

    const origFindOneAndDelete = MedicalRecord.findOneAndDelete;
    MedicalRecord.findOneAndDelete = ({ _id, patientId: pId }) => {
      if (pId === patientId && _id === recordId) {
        return Promise.resolve({
          _id: recordId,
          patientId,
          fileUrl: `/uploads/${fileName}`,
        });
      }
      return Promise.resolve(null);
    };

    try {
      const useCase = new DeleteMedicalRecord();
      
      // Attempt by wrong user must throw and not delete file
      await assert.rejects(
        () => useCase.execute("wrong-user-id", recordId),
        /don't have permission/i
      );
      assert.equal(fs.existsSync(testFile), true);

      // Attempt by authorized patient succeeds and unlinks file
      const deleted = await useCase.execute(patientId, recordId);
      assert.equal(deleted._id, recordId);
      assert.equal(fs.existsSync(testFile), false, "File was not physically removed upon record deletion!");
    } finally {
      MedicalRecord.findOneAndDelete = origFindOneAndDelete;
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    }
  });

  it("enforces patient ownership and safely deletes S3 object from private bucket upon medical record deletion", async () => {
    const patientId = new mongoose.Types.ObjectId().toString();
    const recordId = new mongoose.Types.ObjectId().toString();
    const s3Key = "medical-records/medrec-test-delete.pdf";

    let deletedS3Calls = [];
    const origDelete = s3StorageService.delete.bind(s3StorageService);
    s3StorageService.delete = async (key, opts) => {
      deletedS3Calls.push({ key, opts });
      return { success: true, key };
    };

    const origFindOneAndDelete = MedicalRecord.findOneAndDelete;
    MedicalRecord.findOneAndDelete = async (filter) => {
      if (filter._id === recordId && filter.patientId === patientId) {
        return {
          _id: recordId,
          patientId,
          fileUrl: s3Key,
        };
      }
      return null;
    };

    try {
      const useCase = new DeleteMedicalRecord();

      // Unauthorized patient cannot delete
      await assert.rejects(
        async () => {
          await useCase.execute("wrong_patient_id", recordId);
        },
        /not found or you don't have permission/i
      );
      assert.equal(deletedS3Calls.length, 0, "S3 object was deleted for unauthorized user!");

      // Authorized patient successfully triggers S3 deletion
      const deleted = await useCase.execute(patientId, recordId);
      assert.equal(deleted._id, recordId);
      assert.equal(deletedS3Calls.length, 1);
      assert.equal(deletedS3Calls[0].key, s3Key);
      assert.equal(deletedS3Calls[0].opts.bucketType, "private");
    } finally {
      MedicalRecord.findOneAndDelete = origFindOneAndDelete;
      s3StorageService.delete = origDelete;
    }
  });
});

describe("5. Phase B4 Private Document & Patient Avatar S3 Ingestion Use Cases", () => {
  let origS3Upload;
  let uploadCalls = [];

  beforeEach(() => {
    uploadCalls = [];
    origS3Upload = s3StorageService.upload.bind(s3StorageService);
    s3StorageService.upload = async (params) => {
      uploadCalls.push(params);
      return {
        key: `${params.folder ? params.folder + "/" : ""}${params.prefix}-mock-uuid.bin`,
        bucket: params.bucketType === "public" ? "test-public-bucket" : "test-private-bucket",
        bucketType: params.bucketType,
        url: params.bucketType === "public" ? `https://test.cloudfront.net/${params.prefix}-mock-uuid.bin` : null,
      };
    };
  });

  afterEach(() => {
    s3StorageService.upload = origS3Upload;
  });

  it("UpdatePatientProfile uploads avatar to public S3 bucket and persists CloudFront URL", async () => {
    const updatedPayloads = [];
    const mockUserRepo = {
      findById: async () => ({ role: "patient" }),
      updatePatientProfile: async (userId, data) => {
        updatedPayloads.push({ userId, data });
        return { id: userId, ...data };
      },
    };

    const useCase = new UpdatePatientProfile(mockUserRepo);
    const mockAvatarFile = {
      buffer: JPEG_HEADER,
      originalname: "my-photo.jpg",
      mimetype: "image/jpeg",
      size: JPEG_HEADER.length,
    };

    const result = await useCase.execute("patient_123", { firstName: "Jane" }, { avatar: [mockAvatarFile] });

    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0].bucketType, "public", "Patient avatar was not uploaded to public bucket!");
    assert.equal(uploadCalls[0].folder, "avatars");
    assert.ok(result.avatarUrl.startsWith("https://test.cloudfront.net"));
    assert.ok(!result.avatarUrl.includes("X-Amz-Signature"), "Presigned URL was erroneously saved in DB!");
  });

  it("UpdatePatientProfile rejects corrupt avatar before dispatching S3 upload", async () => {
    const mockUserRepo = {
      findById: async () => ({ role: "patient" }),
      updatePatientProfile: async () => {},
    };

    const useCase = new UpdatePatientProfile(mockUserRepo);
    const corruptFile = {
      buffer: MALICIOUS_SCRIPT,
      originalname: "my-photo.jpg",
      mimetype: "image/jpeg",
      size: MALICIOUS_SCRIPT.length,
    };

    await assert.rejects(
      async () => {
        await useCase.execute("patient_123", { firstName: "Jane" }, { avatar: [corruptFile] });
      },
      /signature mismatch/i
    );

    assert.equal(uploadCalls.length, 0, "Corrupt file was dispatched to S3!");
  });

  it("UpdateDoctorProfile uploads medical cert, gov ID, and qualifications to private S3 bucket and persists stable keys", async () => {
    const updatedPayloads = [];
    const mockUserRepo = {
      findById: async () => ({
        verificationStatus: "pending",
        doctorProfile: {
          avatarUrl: "avatars/existing-doctor.jpg",
        },
      }),
      updateDoctorProfile: async (userId, data) => {
        updatedPayloads.push({ userId, data });
        return { id: userId, ...data };
      },
    };

    const useCase = new UpdateDoctorProfile(mockUserRepo);

    const mockMedCert = {
      buffer: PDF_HEADER,
      originalname: "council-cert.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    const mockGovId = {
      buffer: PDF_HEADER,
      originalname: "passport.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    const mockQualCert = {
      buffer: PDF_HEADER,
      originalname: "q1___degree.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    const profileData = {
      firstName: "Dr. Gregory",
      lastName: "House",
      phone: "+919876543210",
      qualifications: [{ id: "q1", degree: "MD" }],
      consultationSettings: { online: { enabled: true, fee: 500 } },
      workingHours: {
        online: {
          monday: { active: true, startTime: "09:00", endTime: "12:00" },
        },
      },
      slotDuration: 15,
    };

    const files = {
      medicalCertificate: [mockMedCert],
      governmentId: [mockGovId],
      qualificationCertificates: [mockQualCert],
    };

    const result = await useCase.execute("doc_123", profileData, files);

    // Verify all 3 verification documents uploaded to private bucket
    assert.equal(uploadCalls.length, 3);
    for (const call of uploadCalls) {
      assert.equal(call.bucketType, "private", "Verification doc was not uploaded to private bucket!");
    }

    assert.ok(result.medicalCertificateUrl.startsWith("medical-certificates/medcert-"));
    assert.ok(result.governmentIdUrl.startsWith("government-ids/govid-"));
    assert.ok(result.qualifications[0].certificateUrl.startsWith("qualifications/qual-"));

    // Ensure no presigned URLs stored in database
    assert.ok(!result.medicalCertificateUrl.includes("X-Amz-Signature"));
    assert.ok(!result.governmentIdUrl.includes("X-Amz-Signature"));
    assert.ok(!result.qualifications[0].certificateUrl.includes("X-Amz-Signature"));
  });

  it("UpdateDoctorProfile uploads doctor avatar to public S3 bucket with CloudFront URL", async () => {
    const mockUserRepo = {
      findById: async () => ({
        verificationStatus: "pending",
        doctorProfile: {
          medicalCertificateUrl: "medical-certificates/existing.pdf",
          governmentIdUrl: "government-ids/existing.pdf",
        },
      }),
      updateDoctorProfile: async (userId, data) => ({ id: userId, ...data }),
    };

    const useCase = new UpdateDoctorProfile(mockUserRepo);

    const mockAvatar = {
      buffer: JPEG_HEADER,
      originalname: "doctor-avatar.jpg",
      mimetype: "image/jpeg",
      size: JPEG_HEADER.length,
    };

    const profileData = {
      firstName: "Dr. Jane",
      lastName: "Doc",
      consultationSettings: { online: { enabled: true, fee: 500 } },
      workingHours: {
        online: {
          monday: { active: true, startTime: "09:00", endTime: "12:00" },
        },
      },
    };

    const result = await useCase.execute("doc_456", profileData, { avatar: [mockAvatar] });

    // Verify avatar upload was sent to public bucket with avatars folder
    assert.equal(uploadCalls.length, 1);
    assert.equal(uploadCalls[0].bucketType, "public", "Doctor avatar was not sent to public bucket!");
    assert.equal(uploadCalls[0].folder, "avatars");
    assert.ok(result.avatarUrl.startsWith("https://test.cloudfront.net"), "Avatar was not given public CloudFront URL!");
  });

  it("UpdateDoctorProfile rejects profile completion when avatar is missing with 'Profile picture is mandatory'", async () => {
    const mockUserRepo = {
      findById: async () => ({
        verificationStatus: "pending",
        doctorProfile: {},
      }),
      updateDoctorProfile: async (userId, data) => ({ id: userId, ...data }),
    };

    const useCase = new UpdateDoctorProfile(mockUserRepo);

    const profileData = {
      firstName: "Dr. NoAvatar",
      lastName: "Tester",
      consultationSettings: { online: { enabled: true, fee: 500 } },
      workingHours: {
        online: {
          monday: { active: true, startTime: "09:00", endTime: "12:00" },
        },
      },
    };

    await assert.rejects(
      async () => {
        await useCase.execute("doc_missing_avatar", profileData, {});
      },
      (err) => {
        assert.equal(err.message, "Profile picture is mandatory");
        assert.equal(err.statusCode, 400);
        return true;
      }
    );
  });

  it("validateDoctorAvatar middleware returns HTTP 400 when avatar file and URL are both missing", async () => {
    const mockUserRepo = {
      findById: async () => ({
        doctorProfile: {},
      }),
    };

    const middleware = validateDoctorAvatar(mockUserRepo);

    const req = {
      files: {},
      body: { data: JSON.stringify({ firstName: "Dr. Test" }) },
      user: { id: "doc_test_123" },
    };

    let responseStatus = null;
    let responseJson = null;

    const res = {
      status: (code) => {
        responseStatus = code;
        return {
          json: (body) => {
            responseJson = body;
          },
        };
      },
    };

    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(responseStatus, 400);
    assert.equal(responseJson.success, false);
    assert.equal(responseJson.message, "Profile picture is mandatory");
    assert.equal(responseJson.field, "avatar");
  });

  it("validateDoctorAvatar middleware calls next() when avatar file is present", async () => {
    const middleware = validateDoctorAvatar(null);

    const req = {
      files: { avatar: [{ originalname: "avatar.jpg" }] },
      body: {},
      user: { id: "doc_test_123" },
    };

    let nextCalled = false;
    await middleware(req, {}, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  });
});

describe("6. Phase B5 Medical Records & Consultation Attachments S3 Ingestion Use Cases", () => {
  let origS3Upload;
  let origS3Delete;
  let uploadCalls = [];
  let deleteCalls = [];

  beforeEach(() => {
    uploadCalls = [];
    deleteCalls = [];
    origS3Upload = s3StorageService.upload.bind(s3StorageService);
    origS3Delete = s3StorageService.delete.bind(s3StorageService);

    s3StorageService.upload = async (params) => {
      uploadCalls.push(params);
      return {
        key: `${params.folder ? params.folder + "/" : ""}${params.prefix}-mock-uuid.pdf`,
        bucket: params.bucketType === "public" ? "test-public-bucket" : "test-private-bucket",
        bucketType: params.bucketType,
        url: null,
      };
    };

    s3StorageService.delete = async (key, opts) => {
      deleteCalls.push({ key, opts });
      return { success: true, key };
    };
  });

  afterEach(() => {
    s3StorageService.upload = origS3Upload;
    s3StorageService.delete = origS3Delete;
  });

  it("AddMedicalRecord uploads file to private S3 bucket and persists stable key", async () => {
    const patientId = new mongoose.Types.ObjectId().toString();
    const useCase = new AddMedicalRecord();

    const mockFile = {
      buffer: PDF_HEADER,
      originalname: "blood-test.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    const origSave = MedicalRecord.prototype.save;
    let savedDoc = null;
    MedicalRecord.prototype.save = async function() {
      savedDoc = this;
      return this;
    };

    try {
      const result = await useCase.execute(patientId, { title: "CBC Report", category: "Lab Results" }, mockFile);

      assert.equal(uploadCalls.length, 1);
      assert.equal(uploadCalls[0].bucketType, "private", "Medical record was not uploaded to private bucket!");
      assert.equal(uploadCalls[0].folder, "medical-records");
      assert.ok(result.fileUrl.startsWith("medical-records/medrec-"));
      assert.ok(!result.fileUrl.includes("X-Amz-Signature"), "Presigned URL was erroneously saved in DB!");
      assert.equal(result.title, "CBC Report");
    } finally {
      MedicalRecord.prototype.save = origSave;
    }
  });

  it("AddMedicalRecord rejects corrupt file before dispatching S3 upload", async () => {
    const patientId = new mongoose.Types.ObjectId().toString();
    const useCase = new AddMedicalRecord();

    const corruptFile = {
      buffer: MALICIOUS_SCRIPT,
      originalname: "blood-test.pdf",
      mimetype: "application/pdf",
      size: MALICIOUS_SCRIPT.length,
    };

    await assert.rejects(
      async () => {
        await useCase.execute(patientId, { title: "Fake Report" }, corruptFile);
      },
      /signature mismatch/i
    );

    assert.equal(uploadCalls.length, 0, "Corrupt file was dispatched to S3!");
  });

  it("AddMedicalRecord rolls back uploaded S3 object if MongoDB save fails", async () => {
    const patientId = new mongoose.Types.ObjectId().toString();
    const useCase = new AddMedicalRecord();

    const mockFile = {
      buffer: PDF_HEADER,
      originalname: "blood-test.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    const origSave = MedicalRecord.prototype.save;
    MedicalRecord.prototype.save = async function() {
      throw new Error("Simulated database connection failure");
    };

    try {
      await assert.rejects(
        async () => {
          await useCase.execute(patientId, { title: "CBC Report" }, mockFile);
        },
        /Simulated database connection failure/
      );

      // Verify that S3 upload was attempted, but when save failed, rollback delete was called
      assert.equal(uploadCalls.length, 1);
      assert.equal(deleteCalls.length, 1, "S3 uploaded object was not rolled back after DB save failure!");
      assert.equal(deleteCalls[0].opts.bucketType, "private");
      assert.ok(deleteCalls[0].key.startsWith("medical-records/medrec-"));
    } finally {
      MedicalRecord.prototype.save = origSave;
    }
  });

  it("uploadConsultationFile uploads attachment to private S3 bucket, enforces authorization, and persists stable key", async () => {
    const appointmentId = new mongoose.Types.ObjectId();
    const doctorProfileId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    const origFindById = Appointment.findById;
    const origSave = Appointment.prototype.save;
    const origFindOneAndUpdate = ConsultationRecord.findOneAndUpdate;
    const origSharedFindById = SharedUser.findById;

    let savedFiles = [];
    Appointment.findById = async () => ({
      _id: appointmentId,
      doctorId: doctorProfileId,
      patientId: patientUserId,
      consultationFiles: [],
      save: async function() {
        savedFiles = this.consultationFiles;
        return this;
      },
    });

    SharedUser.findById = async () => ({
      _id: patientUserId,
      profileId: patientUserId,
    });

    ConsultationRecord.findOneAndUpdate = async () => ({
      _id: new mongoose.Types.ObjectId(),
    });

    const mockFile = {
      buffer: PDF_HEADER,
      originalname: "clinical-notes.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    try {
      // 1. Authorized Patient uploading
      const req = {
        params: { id: appointmentId.toString() },
        file: mockFile,
        body: { category: "Lab Report" },
        user: { id: patientUserId.toString(), role: "patient" },
      };
      const res = createMockRes();

      await uploadConsultationFile(req, res);
      assert.equal(res.statusCode, 201);
      assert.equal(res.body.success, true);
      assert.equal(uploadCalls.length, 1);
      assert.equal(uploadCalls[0].bucketType, "private");
      assert.equal(uploadCalls[0].folder, "consultations");
      assert.ok(res.body.file.url.startsWith("consultations/consult-"));
      assert.ok(!res.body.file.url.includes("X-Amz-Signature"));
    } finally {
      Appointment.findById = origFindById;
      Appointment.prototype.save = origSave;
      ConsultationRecord.findOneAndUpdate = origFindOneAndUpdate;
      SharedUser.findById = origSharedFindById;
    }
  });

  it("uploadConsultationFile rejects unauthorized doctor from uploading consultation file (403)", async () => {
    const appointmentId = new mongoose.Types.ObjectId();
    const doctorAProfileId = new mongoose.Types.ObjectId();
    const doctorBUserId = new mongoose.Types.ObjectId();
    const doctorBProfileId = new mongoose.Types.ObjectId();

    const origFindById = Appointment.findById;
    const origSharedFindById = SharedUser.findById;

    Appointment.findById = async () => ({
      _id: appointmentId,
      doctorId: doctorAProfileId,
      patientId: new mongoose.Types.ObjectId(),
    });

    SharedUser.findById = async () => ({
      _id: doctorBUserId,
      profileId: doctorBProfileId,
    });

    const mockFile = {
      buffer: PDF_HEADER,
      originalname: "clinical-notes.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    try {
      // Doctor B attempts to upload file to Doctor A's appointment
      const req = {
        params: { id: appointmentId.toString() },
        file: mockFile,
        body: {},
        user: { id: doctorBUserId.toString(), role: "doctor" },
      };
      const res = createMockRes();

      await uploadConsultationFile(req, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Not authorized/i);
      assert.equal(uploadCalls.length, 0, "File was dispatched to S3 despite authorization failure!");
    } finally {
      Appointment.findById = origFindById;
      SharedUser.findById = origSharedFindById;
    }
  });

  it("uploadConsultationFile rolls back uploaded S3 object if database persistence throws", async () => {
    const appointmentId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    const origFindById = Appointment.findById;
    const origSharedFindById = SharedUser.findById;

    Appointment.findById = async () => ({
      _id: appointmentId,
      doctorId: new mongoose.Types.ObjectId(),
      patientId: patientUserId,
      consultationFiles: [],
      save: async function() {
        throw new Error("Simulated appointment write crash");
      },
    });

    SharedUser.findById = async () => ({
      _id: patientUserId,
      profileId: patientUserId,
    });

    const mockFile = {
      buffer: PDF_HEADER,
      originalname: "test-scan.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    try {
      const req = {
        params: { id: appointmentId.toString() },
        file: mockFile,
        body: {},
        user: { id: patientUserId.toString(), role: "patient" },
      };
      const res = createMockRes();

      await uploadConsultationFile(req, res);
      assert.equal(res.statusCode, 500);

      // Verify that S3 upload happened, but rollback cleanup was triggered
      assert.equal(uploadCalls.length, 1);
      assert.equal(deleteCalls.length, 1, "S3 object was not rolled back after DB write crash!");
      assert.equal(deleteCalls[0].opts.bucketType, "private");
      assert.ok(deleteCalls[0].key.startsWith("consultations/consult-"));
    } finally {
      Appointment.findById = origFindById;
      SharedUser.findById = origSharedFindById;
    }
  });
});

describe("7. Phase B6 Dispute Proof S3 Ingestion, Validation & Rollback Use Cases", () => {
  let origS3Upload;
  let origS3Delete;
  let origAdminFindOne;
  let uploadCalls = [];
  let deleteCalls = [];

  beforeEach(() => {
    uploadCalls = [];
    deleteCalls = [];
    origS3Upload = s3StorageService.upload.bind(s3StorageService);
    origS3Delete = s3StorageService.delete.bind(s3StorageService);
    origAdminFindOne = Admin.findOne;
    Admin.findOne = () => chainableQuery(null);

    s3StorageService.upload = async (params) => {
      uploadCalls.push(params);
      return {
        key: `${params.folder ? params.folder + "/" : ""}${params.prefix}-mock-uuid.pdf`,
        bucket: params.bucketType === "public" ? "test-public-bucket" : "test-private-bucket",
        bucketType: params.bucketType,
        url: null,
      };
    };

    s3StorageService.delete = async (key, opts) => {
      deleteCalls.push({ key, opts });
      return { success: true, key };
    };
  });

  afterEach(() => {
    s3StorageService.upload = origS3Upload;
    s3StorageService.delete = origS3Delete;
    Admin.findOne = origAdminFindOne;
  });

  it("disputeAppointment uploads proof file to private S3 bucket and persists stable key", async () => {
    const appointmentId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    const origFindById = Appointment.findById;
    const origSharedFindById = SharedUser.findById;

    let savedAppointment = null;
    Appointment.findById = async () => ({
      _id: appointmentId,
      patientId: patientUserId,
      doctorId: new mongoose.Types.ObjectId(),
      status: "no-show",
      consultationType: "offline",
      scheduledEndAt: new Date(Date.now() - 3600000),
      disputeReason: null,
      disputeProofUrl: null,
      disputedAt: null,
      save: async function() {
        savedAppointment = this;
        return this;
      },
    });

    SharedUser.findById = async () => ({
      _id: patientUserId,
      profileId: patientUserId,
    });

    const mockFile = {
      buffer: PDF_HEADER,
      originalname: "evidence.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    try {
      const req = {
        params: { id: appointmentId.toString() },
        file: mockFile,
        body: { reason: "Doctor did not attend consultation" },
        user: { id: patientUserId.toString(), role: "patient" },
      };
      const res = createMockRes();

      await disputeAppointment(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.equal(uploadCalls.length, 1);
      assert.equal(uploadCalls[0].bucketType, "private", "Dispute proof was uploaded to public bucket!");
      assert.equal(uploadCalls[0].folder, "dispute-proofs");
      assert.equal(savedAppointment.status, "disputed");
      assert.equal(savedAppointment.disputeReason, "Doctor did not attend consultation");
      assert.ok(savedAppointment.disputeProofUrl.startsWith("dispute-proofs/dispute-"));
      assert.ok(!savedAppointment.disputeProofUrl.includes("X-Amz-Signature"), "Presigned URL was erroneously saved in DB!");
    } finally {
      Appointment.findById = origFindById;
      SharedUser.findById = origSharedFindById;
    }
  });

  it("disputeAppointment accepts valid string proofUrl (both S3 key format and /uploads/...)", async () => {
    const appointmentId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    const origFindById = Appointment.findById;
    const origSharedFindById = SharedUser.findById;

    let savedAppointment = null;
    Appointment.findById = async () => ({
      _id: appointmentId,
      patientId: patientUserId,
      doctorId: new mongoose.Types.ObjectId(),
      status: "no-show",
      consultationType: "offline",
      scheduledEndAt: new Date(Date.now() - 3600000),
      disputeReason: null,
      disputeProofUrl: null,
      save: async function() {
        savedAppointment = this;
        return this;
      },
    });

    SharedUser.findById = async () => ({
      _id: patientUserId,
      profileId: patientUserId,
    });

    try {
      const req = {
        params: { id: appointmentId.toString() },
        body: {
          reason: "Consultation issues",
          proofUrl: "dispute-proofs/dispute-preuploaded.pdf",
        },
        user: { id: patientUserId.toString(), role: "patient" },
      };
      const res = createMockRes();

      await disputeAppointment(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(uploadCalls.length, 0); // No new upload
      assert.equal(savedAppointment.disputeProofUrl, "dispute-proofs/dispute-preuploaded.pdf");
    } finally {
      Appointment.findById = origFindById;
      SharedUser.findById = origSharedFindById;
    }
  });

  it("disputeAppointment rejects corrupt proof file before S3 upload (400 signature mismatch)", async () => {
    const appointmentId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    const origFindById = Appointment.findById;
    const origSharedFindById = SharedUser.findById;

    Appointment.findById = async () => ({
      _id: appointmentId,
      patientId: patientUserId,
      doctorId: new mongoose.Types.ObjectId(),
      status: "no-show",
      consultationType: "offline",
      scheduledEndAt: new Date(Date.now() - 3600000),
    });

    SharedUser.findById = async () => ({
      _id: patientUserId,
      profileId: patientUserId,
    });

    const corruptFile = {
      buffer: MALICIOUS_SCRIPT,
      originalname: "evidence.pdf",
      mimetype: "application/pdf",
      size: MALICIOUS_SCRIPT.length,
    };

    try {
      const req = {
        params: { id: appointmentId.toString() },
        file: corruptFile,
        body: { reason: "Consultation issue" },
        user: { id: patientUserId.toString(), role: "patient" },
      };
      const res = createMockRes();

      await disputeAppointment(req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /signature mismatch/i);
      assert.equal(uploadCalls.length, 0, "Corrupt file was uploaded to S3!");
    } finally {
      Appointment.findById = origFindById;
      SharedUser.findById = origSharedFindById;
    }
  });

  it("disputeAppointment rolls back uploaded S3 object if appointment.save() throws", async () => {
    const appointmentId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    const origFindById = Appointment.findById;
    const origSharedFindById = SharedUser.findById;

    Appointment.findById = async () => ({
      _id: appointmentId,
      patientId: patientUserId,
      doctorId: new mongoose.Types.ObjectId(),
      status: "no-show",
      consultationType: "offline",
      scheduledEndAt: new Date(Date.now() - 3600000),
      save: async function() {
        throw new Error("Simulated appointment dispute write error");
      },
    });

    SharedUser.findById = async () => ({
      _id: patientUserId,
      profileId: patientUserId,
    });

    const mockFile = {
      buffer: PDF_HEADER,
      originalname: "evidence.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    try {
      const req = {
        params: { id: appointmentId.toString() },
        file: mockFile,
        body: { reason: "Simulated crash test" },
        user: { id: patientUserId.toString(), role: "patient" },
      };
      const res = createMockRes();

      await disputeAppointment(req, res);
      assert.equal(res.statusCode, 500);

      assert.equal(uploadCalls.length, 1);
      assert.equal(deleteCalls.length, 1, "S3 uploaded proof was not rolled back after DB crash!");
      assert.equal(deleteCalls[0].opts.bucketType, "private");
      assert.ok(deleteCalls[0].key.startsWith("dispute-proofs/dispute-"));
    } finally {
      Appointment.findById = origFindById;
      SharedUser.findById = origSharedFindById;
    }
  });

  it("disputeAppointment rejects dispute if caller is not the appointment's patient (403)", async () => {
    const appointmentId = new mongoose.Types.ObjectId();
    const patientAId = new mongoose.Types.ObjectId();
    const patientBId = new mongoose.Types.ObjectId();

    const origFindById = Appointment.findById;
    const origSharedFindById = SharedUser.findById;

    Appointment.findById = async () => ({
      _id: appointmentId,
      patientId: patientAId,
      doctorId: new mongoose.Types.ObjectId(),
      status: "no-show",
      consultationType: "offline",
      scheduledEndAt: new Date(Date.now() - 3600000),
    });

    SharedUser.findById = async () => ({
      _id: patientBId,
      profileId: patientBId,
    });

    const mockFile = {
      buffer: PDF_HEADER,
      originalname: "evidence.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    try {
      const req = {
        params: { id: appointmentId.toString() },
        file: mockFile,
        body: { reason: "Unauthorized attempt" },
        user: { id: patientBId.toString(), role: "patient" },
      };
      const res = createMockRes();

      await disputeAppointment(req, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /not authorized to dispute/i);
      assert.equal(uploadCalls.length, 0, "File was uploaded to S3 despite 403 authorization error!");
    } finally {
      Appointment.findById = origFindById;
      SharedUser.findById = origSharedFindById;
    }
  });
});

describe("8. Phase B7 Local Disk Fallback & Compatibility Verification", () => {
  let origDoctorFindOne;
  let origSharedUserFindOne;

  beforeEach(() => {
    origDoctorFindOne = Doctor.findOne;
    origSharedUserFindOne = SharedUser.findOne;
    Doctor.findOne = () => chainableQuery(null);
    SharedUser.findOne = () => chainableQuery(null);
  });

  afterEach(() => {
    Doctor.findOne = origDoctorFindOne;
    SharedUser.findOne = origSharedUserFindOne;
  });

  it("AddMedicalRecord writes to local disk when S3 is unconfigured", async () => {
    const patientId = new mongoose.Types.ObjectId().toString();
    const useCase = new AddMedicalRecord();

    const origIsConfigured = s3StorageService.isConfigured.bind(s3StorageService);
    s3StorageService.isConfigured = () => false;

    const mockFile = {
      buffer: PDF_HEADER,
      filename: "local-medrec-test.pdf",
      originalname: "local-medrec-test.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    const origSave = MedicalRecord.prototype.save;
    let savedDoc = null;
    MedicalRecord.prototype.save = async function() {
      savedDoc = this;
      return this;
    };

    try {
      const result = await useCase.execute(patientId, { title: "Local Report" }, mockFile);
      assert.equal(result.fileUrl, "/uploads/local-medrec-test.pdf");
      assert.equal(savedDoc.fileUrl, "/uploads/local-medrec-test.pdf");
    } finally {
      MedicalRecord.prototype.save = origSave;
      s3StorageService.isConfigured = origIsConfigured;
    }
  });

  it("disputeAppointment writes to local disk when S3 is unconfigured", async () => {
    const appointmentId = new mongoose.Types.ObjectId();
    const patientUserId = new mongoose.Types.ObjectId();

    const origFindById = Appointment.findById;
    const origSharedFindById = SharedUser.findById;
    const origAdminFindOne = Admin.findOne;
    const origIsConfigured = s3StorageService.isConfigured.bind(s3StorageService);

    s3StorageService.isConfigured = () => false;
    Admin.findOne = () => chainableQuery(null);

    let savedAppointment = null;
    Appointment.findById = async () => ({
      _id: appointmentId,
      patientId: patientUserId,
      doctorId: new mongoose.Types.ObjectId(),
      status: "no-show",
      consultationType: "offline",
      scheduledEndAt: new Date(Date.now() - 3600000),
      disputeReason: null,
      disputeProofUrl: null,
      disputedAt: null,
      save: async function() {
        savedAppointment = this;
        return this;
      },
    });

    SharedUser.findById = async () => ({
      _id: patientUserId,
      profileId: patientUserId,
    });

    const mockFile = {
      filename: "local-dispute-test.pdf",
      path: "uploads/local-dispute-test.pdf",
      originalname: "local-dispute-test.pdf",
      mimetype: "application/pdf",
      size: PDF_HEADER.length,
    };

    try {
      const req = {
        params: { id: appointmentId.toString() },
        file: mockFile,
        body: { reason: "Clinic was closed" },
        user: { id: patientUserId.toString(), role: "patient" },
      };
      const res = createMockRes();

      await disputeAppointment(req, res);
      assert.equal(res.statusCode, 200);
      assert.equal(savedAppointment.disputeProofUrl, "/uploads/local-dispute-test.pdf");
    } finally {
      Appointment.findById = origFindById;
      SharedUser.findById = origSharedFindById;
      Admin.findOne = origAdminFindOne;
      s3StorageService.isConfigured = origIsConfigured;
    }
  });

  it("proves alias paths (e.g. /patient-avatars/:filename, /medical-certificates/:filename) enforce identical gatekeeping", async () => {
    // Unauthenticated request to alias path must return 401
    const req = {
      params: { filename: "avatar-secret.jpg" },
      headers: {},
      cookies: {},
    };
    const res = createMockRes();

    await secureFileController.getFile(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.success, false);
    assert.match(res.body.message, /Authentication required/i);
  });
});



