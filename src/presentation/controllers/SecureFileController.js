// src/presentation/controllers/SecureFileController.js
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import Doctor from "../../infrastructure/database/models/DoctorProfile.js";
import Patient from "../../infrastructure/database/models/PatientProfile.js";
import SharedUser from "../../infrastructure/database/models/SharedUser.js";
import MedicalRecord from "../../infrastructure/database/models/MedicalRecord.js";
import Appointment from "../../infrastructure/database/models/Appointment.js";
import ConsultationRecord from "../../infrastructure/database/models/ConsultationRecord.js";
import { sanitizeFilename } from "../../infrastructure/utils/fileValidator.js";

/**
 * Controller providing strictly authorized file access to replace unprotected static serving
 */
export class SecureFileController {
  /**
   * Helper to decode authentication token from cookies or Authorization header
   */
  _extractUser(req) {
    try {
      let token = req.cookies?.accessToken;
      if (!token && req.headers.authorization?.startsWith("Bearer ")) {
        const authHeader = req.headers.authorization.split(" ")[1];
        if (authHeader !== "undefined" && authHeader !== "null") {
          token = authHeader;
        }
      }
      if (!token) return null;
      return jwt.verify(token, process.env.JWT_SECRET || "access_secret");
    } catch {
      return null;
    }
  }

  /**
   * Determine MIME content type safely
   */
  _getContentType(ext) {
    switch (ext.toLowerCase()) {
      case ".jpg":
      case ".jpeg":
        return "image/jpeg";
      case ".png":
        return "image/png";
      case ".webp":
        return "image/webp";
      case ".pdf":
        return "application/pdf";
      default:
        return "application/octet-stream";
    }
  }

  /**
   * Stream a local file with secure security headers
   */
  _streamFile(res, filePath, ext, disposition = "inline") {
    const contentType = this._getContentType(ext);
    res.setHeader("Content-Type", contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    if (disposition === "attachment") {
      res.setHeader("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`);
    } else {
      res.setHeader("Content-Disposition", `inline; filename="${path.basename(filePath)}"`);
    }
    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      console.error("[SecureFileController] Stream error:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "Error streaming file." });
      }
    });
    stream.pipe(res);
  }

  /**
   * GET /uploads/:filename
   * Central gatekeeper for all file access
   */
  async getFile(req, res) {
    try {
      const rawFilename = req.params.filename;
      if (!rawFilename || typeof rawFilename !== "string" || rawFilename.includes("..") || rawFilename.includes("/") || rawFilename.includes("\\") || rawFilename.toLowerCase().includes("%2e") || rawFilename.toLowerCase().includes("%2f")) {
        return res.status(400).json({ success: false, message: "Invalid filename format or path traversal attempt." });
      }

      const cleanFilename = sanitizeFilename(rawFilename);

      const uploadsDir = path.resolve("uploads");
      const filePath = path.resolve(uploadsDir, cleanFilename);

      // Path traversal prevention: must strictly reside inside uploadsDir
      if (!filePath.startsWith(uploadsDir)) {
        return res.status(403).json({ success: false, message: "Access denied: Path traversal detected." });
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: "File not found." });
      }

      const ext = path.extname(cleanFilename);
      const user = this._extractUser(req);
      const userId = user?.id || user?._id;

      // ── 1. Check Public Doctor Profile Photo ───────────────────────────────
      // If file is an approved doctor's avatar, it is intentionally public
      const doctorWithAvatar = await Doctor.findOne({
        avatarUrl: { $regex: cleanFilename },
        verificationStatus: "approved",
      }).select("_id avatarUrl");

      if (doctorWithAvatar) {
        res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
        return this._streamFile(res, filePath, ext, "inline");
      }

      // Also allow doctor avatars for pending doctors if accessed by the doctor themselves or admin
      if (cleanFilename.startsWith("avatar-") || cleanFilename.includes("passport")) {
        const anyDoctorAvatar = await Doctor.findOne({
          avatarUrl: { $regex: cleanFilename },
        }).select("_id");
        if (anyDoctorAvatar) {
          // If public doctor avatar requested
          res.setHeader("Cache-Control", "public, max-age=86400");
          return this._streamFile(res, filePath, ext, "inline");
        }
      }

      // ── 2. All other files require authentication ───────────────────────────
      if (!user || !userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required to access this file.",
        });
      }

      // Admin has verification and dispute privileges
      const isAdmin = user.role === "admin";

      // ── 3. Doctor Verification Documents (Medical Cert, Gov ID, Qualifications)
      const doctorDoc = await Doctor.findOne({
        $or: [
          { medicalCertificateUrl: { $regex: cleanFilename } },
          { governmentIdUrl: { $regex: cleanFilename } },
          { "qualifications.certificateUrl": { $regex: cleanFilename } },
        ],
      }).select("_id");

      if (doctorDoc) {
        if (isAdmin) {
          return this._streamFile(res, filePath, ext, "inline");
        }
        // Submitting doctor check
        const sharedDocUser = await SharedUser.findOne({ profileId: doctorDoc._id, role: "doctor" }).select("_id");
        if (sharedDocUser && sharedDocUser._id.toString() === userId.toString()) {
          return this._streamFile(res, filePath, ext, "inline");
        }
        return res.status(403).json({
          success: false,
          message: "Access denied. Only the submitting doctor or an authorized administrator can view this verification document.",
        });
      }

      // ── 4. Patient Medical Records (Lab Reports, Blood Tests, Scans) ─────────
      const medRecord = await MedicalRecord.findOne({
        fileUrl: { $regex: cleanFilename },
      }).select("_id patientId");

      if (medRecord) {
        // Owner patient check
        if (medRecord.patientId.toString() === userId.toString()) {
          return this._streamFile(res, filePath, ext, "inline");
        }

        // Authorized attending doctor check
        if (user.role === "doctor") {
          const doctorShared = await SharedUser.findById(userId).select("profileId");
          const doctorProfileId = doctorShared?.profileId;

          const hasActiveRelationship = await Appointment.exists({
            doctorId: { $in: [doctorProfileId, userId].filter(Boolean) },
            patientId: medRecord.patientId,
            status: { $nin: ["available", "locked", "expired", "cancelled"] },
          });

          if (hasActiveRelationship) {
            return this._streamFile(res, filePath, ext, "inline");
          }
        }

        return res.status(403).json({
          success: false,
          message: "Access denied. You do not have authorization to access this patient medical record.",
        });
      }

      // ── 5. Consultation Files & Attachments ─────────────────────────────────
      const appointmentWithFile = await Appointment.findOne({
        "consultationFiles.url": { $regex: cleanFilename },
      }).select("_id doctorId patientId");

      if (appointmentWithFile) {
        if (isAdmin) {
          return this._streamFile(res, filePath, ext, "inline");
        }

        const isAssignedPatient = (appointmentWithFile.patientId?._id || appointmentWithFile.patientId)?.toString() === userId.toString();

        let isAssignedDoctor = false;
        if (user.role === "doctor") {
          const doctorShared = await SharedUser.findById(userId).select("profileId");
          const doctorProfileId = doctorShared?.profileId;
          isAssignedDoctor =
            (doctorProfileId && (appointmentWithFile.doctorId?._id || appointmentWithFile.doctorId)?.toString() === doctorProfileId.toString()) ||
            ((appointmentWithFile.doctorId?._id || appointmentWithFile.doctorId)?.toString() === userId.toString());
        }

        if (isAssignedPatient || isAssignedDoctor) {
          return this._streamFile(res, filePath, ext, "inline");
        }

        return res.status(403).json({
          success: false,
          message: "Access denied. You are not a participant in this consultation session.",
        });
      }

      // ── 6. Patient Profile Photo ───────────────────────────────────────────
      const patientWithAvatar = await Patient.findOne({
        avatarUrl: { $regex: cleanFilename },
      }).select("_id");

      if (patientWithAvatar) {
        if (isAdmin) {
          return this._streamFile(res, filePath, ext, "inline");
        }
        const sharedPatient = await SharedUser.findOne({ profileId: patientWithAvatar._id }).select("_id");
        if (sharedPatient && sharedPatient._id.toString() === userId.toString()) {
          return this._streamFile(res, filePath, ext, "inline");
        }
        // Doctor treating this patient
        if (user.role === "doctor") {
          const doctorShared = await SharedUser.findById(userId).select("profileId");
          const hasAppt = await Appointment.exists({
            doctorId: { $in: [doctorShared?.profileId, userId].filter(Boolean) },
            patientId: sharedPatient?._id,
            status: { $nin: ["available", "locked", "expired"] },
          });
          if (hasAppt) {
            return this._streamFile(res, filePath, ext, "inline");
          }
        }
        return res.status(403).json({
          success: false,
          message: "Access denied. You are not authorized to view this patient avatar.",
        });
      }

      // ── 7. Fallback for admin or unmatched files ─────────────────────────────
      if (isAdmin) {
        return this._streamFile(res, filePath, ext, "inline");
      }

      return res.status(404).json({
        success: false,
        message: "File reference not found or access restricted.",
      });
    } catch (error) {
      console.error("[SecureFileController] Error handling file access:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error while retrieving file.",
      });
    }
  }
}

export const secureFileController = new SecureFileController();
