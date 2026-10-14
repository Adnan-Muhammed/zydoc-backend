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

import { verifyUploadSignatures } from "../src/presentation/middleware/uploadMiddleware.js";
import { secureFileController } from "../src/presentation/controllers/SecureFileController.js";
import { DeleteMedicalRecord } from "../src/application/usecases/patient/DeleteMedicalRecord.js";

// Models for stubbing/testing
import Doctor from "../src/infrastructure/database/models/DoctorProfile.js";
import Patient from "../src/infrastructure/database/models/PatientProfile.js";
import SharedUser from "../src/infrastructure/database/models/SharedUser.js";
import MedicalRecord from "../src/infrastructure/database/models/MedicalRecord.js";
import Appointment from "../src/infrastructure/database/models/Appointment.js";
import ConsultationRecord from "../src/infrastructure/database/models/ConsultationRecord.js";

import stream from "stream";
const TEST_SECRET = "audit_test_jwt_secret_987654";
process.env.JWT_SECRET = TEST_SECRET;

// Helper to create mock response that supports stream piping
function createMockRes() {
  const res = new stream.PassThrough();
  res.statusCode = 200;
  res.headers = {};
  res.body = null;
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

    Doctor.findOne = () => chainableQuery(null);
    Appointment.findOne = () => chainableQuery(null);
    Appointment.findById = () => chainableQuery(null);
    Appointment.exists = () => Promise.resolve(false);
    Patient.findOne = () => chainableQuery(null);
    SharedUser.findOne = () => chainableQuery(null);
    SharedUser.findById = () => chainableQuery(null);
    ConsultationRecord.findOne = () => chainableQuery(null);
    MedicalRecord.findOne = () => chainableQuery(null);
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
});
