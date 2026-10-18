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
import RefundTicket from "../../infrastructure/database/models/RefundTicket.js";
import { sanitizeFilename } from "../../infrastructure/utils/fileValidator.js";
import { s3StorageService } from "../../infrastructure/services/S3StorageService.js";

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
   * Determine if a stored file URL or key matches the exact requested clean filename.
   * Avoids prefix, suffix, or substring collision (e.g. 'report.pdf' vs 'special-report.pdf').
   */
  _matchesFilename(url, filename) {
    if (!url || typeof url !== "string") return false;
    const cleanUrl = url.split("?")[0].replace(/\\/g, "/");
    return cleanUrl === filename || cleanUrl.endsWith("/" + filename);
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

      const escapedFilename = cleanFilename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const filenameRegex = { $regex: `(?:^|/)${escapedFilename}(?:\\?|$)` };
      const ext = path.extname(cleanFilename);
      const user = this._extractUser(req);
      const userId = user?.id || user?._id;

      // ── 1. Check Doctor Profile Photo (Public only if doctor is Approved & Active) ──
      const doctorWithAvatar = await Doctor.findOne({
        avatarUrl: filenameRegex,
      }).select("_id avatarUrl verificationStatus");

      if (doctorWithAvatar) {
        const sharedDocUser = await SharedUser.findOne({ profileId: doctorWithAvatar._id, role: "doctor" }).select("_id accountStatus");
        const isApprovedAndActive =
          doctorWithAvatar.verificationStatus === "approved" &&
          (!sharedDocUser || sharedDocUser.accountStatus === "active");

        if (isApprovedAndActive) {
          // If stored as CloudFront URL or full HTTPS URL, redirect to CloudFront
          if (doctorWithAvatar.avatarUrl?.startsWith("http://") || doctorWithAvatar.avatarUrl?.startsWith("https://")) {
            return res.redirect(302, doctorWithAvatar.avatarUrl);
          }
          // If stored as S3 key
          if (s3StorageService.isConfigured() && doctorWithAvatar.avatarUrl?.startsWith("avatars/")) {
            return res.redirect(302, s3StorageService.getCloudFrontUrl(doctorWithAvatar.avatarUrl));
          }
          // If local disk file exists, stream it with public cache headers
          if (fs.existsSync(filePath)) {
            res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
            return this._streamFile(res, filePath, ext, "inline");
          }
          // If S3 is configured, fallback to CloudFront URL
          if (s3StorageService.isConfigured()) {
            return res.redirect(302, s3StorageService.getCloudFrontUrl(`avatars/${cleanFilename}`));
          }
          return res.status(404).json({ success: false, message: "File not found." });
        }

        // Unapproved / pending / rejected / suspended doctor avatar: strictly requires auth
        if (!user || !userId) {
          return res.status(401).json({
            success: false,
            message: "Authentication required to access this file.",
          });
        }

        const isAdmin = user.role === "admin";
        const isOwnerDoctor = sharedDocUser && sharedDocUser._id.toString() === userId.toString();

        if (isAdmin || isOwnerDoctor) {
          if (fs.existsSync(filePath)) {
            return this._streamFile(res, filePath, ext, "inline");
          }
          if (s3StorageService.isConfigured()) {
            const cleanKey = s3StorageService.extractObjectKey(doctorWithAvatar.avatarUrl || cleanFilename);
            const presignedUrl = await s3StorageService.getPresignedDownloadUrl(cleanKey, {
              bucketType: "private",
            });
            return res.redirect(302, presignedUrl);
          }
          return res.status(404).json({ success: false, message: "File not found." });
        }

        return res.status(403).json({
          success: false,
          message: "Access denied. Only the doctor or an authorized administrator can view this avatar.",
        });
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
          { medicalCertificateUrl: filenameRegex },
          { governmentIdUrl: filenameRegex },
          { "qualifications.certificateUrl": filenameRegex },
        ],
      }).select("_id medicalCertificateUrl governmentIdUrl qualifications");

      if (doctorDoc) {
        const sharedDocUser = await SharedUser.findOne({ profileId: doctorDoc._id, role: "doctor" }).select("_id");
        const isOwnerDoctor = sharedDocUser && sharedDocUser._id.toString() === userId.toString();

        if (isAdmin || isOwnerDoctor) {
          if (fs.existsSync(filePath)) {
            return this._streamFile(res, filePath, ext, "inline");
          }
          if (s3StorageService.isConfigured()) {
            let matchedKey = null;
            if (this._matchesFilename(doctorDoc.medicalCertificateUrl, cleanFilename)) {
              matchedKey = doctorDoc.medicalCertificateUrl;
            } else if (this._matchesFilename(doctorDoc.governmentIdUrl, cleanFilename)) {
              matchedKey = doctorDoc.governmentIdUrl;
            } else if (doctorDoc.qualifications?.length > 0) {
              const matchingQual = doctorDoc.qualifications.find((q) => this._matchesFilename(q.certificateUrl, cleanFilename));
              if (matchingQual) {
                matchedKey = matchingQual.certificateUrl;
              }
            }
            const cleanKey = s3StorageService.extractObjectKey(matchedKey || cleanFilename);
            const presignedUrl = await s3StorageService.getPresignedDownloadUrl(cleanKey, {
              bucketType: "private",
            });
            return res.redirect(302, presignedUrl);
          }
          return res.status(404).json({ success: false, message: "File not found." });
        }

        return res.status(403).json({
          success: false,
          message: "Access denied. Only the submitting doctor or an authorized administrator can view this verification document.",
        });
      }

      // ── 4. Patient Medical Records (Lab Reports, Blood Tests, Scans) ─────────
      const medRecord = await MedicalRecord.findOne({
        fileUrl: filenameRegex,
      }).select("_id patientId fileUrl");

      if (medRecord) {
        // Owner patient check
        const isOwnerPatient = medRecord.patientId.toString() === userId.toString();

        // Authorized attending doctor check
        let isAttendingDoctor = false;
        if (user.role === "doctor") {
          const doctorShared = await SharedUser.findById(userId).select("profileId");
          const doctorProfileId = doctorShared?.profileId;

          isAttendingDoctor = await Appointment.exists({
            doctorId: { $in: [doctorProfileId, userId].filter(Boolean) },
            patientId: medRecord.patientId,
            status: { $nin: ["available", "locked", "expired", "cancelled"] },
          });
        }

        if (isAdmin || isOwnerPatient || isAttendingDoctor) {
          if (fs.existsSync(filePath)) {
            return this._streamFile(res, filePath, ext, "inline");
          }
          if (s3StorageService.isConfigured()) {
            const cleanKey = s3StorageService.extractObjectKey(medRecord.fileUrl || cleanFilename);
            const presignedUrl = await s3StorageService.getPresignedDownloadUrl(cleanKey, {
              bucketType: "private",
            });
            return res.redirect(302, presignedUrl);
          }
          return res.status(404).json({ success: false, message: "File not found." });
        }

        return res.status(403).json({
          success: false,
          message: "Access denied. You do not have authorization to access this patient medical record.",
        });
      }

      // ── 5. Consultation Files & Attachments ─────────────────────────────────
      let appointmentWithFile = await Appointment.findOne({
        "consultationFiles.url": filenameRegex,
      }).select("_id doctorId patientId consultationFiles");

      if (!appointmentWithFile) {
        appointmentWithFile = await ConsultationRecord.findOne({
          "consultationFiles.url": filenameRegex,
        }).select("_id doctorId patientId consultationFiles");
      }

      if (appointmentWithFile) {
        const isAssignedPatient = (appointmentWithFile.patientId?._id || appointmentWithFile.patientId)?.toString() === userId.toString();

        let isAssignedDoctor = false;
        if (user.role === "doctor") {
          const doctorShared = await SharedUser.findById(userId).select("profileId");
          const doctorProfileId = doctorShared?.profileId;
          isAssignedDoctor =
            (doctorProfileId && (appointmentWithFile.doctorId?._id || appointmentWithFile.doctorId)?.toString() === doctorProfileId.toString()) ||
            ((appointmentWithFile.doctorId?._id || appointmentWithFile.doctorId)?.toString() === userId.toString());
        }

        if (isAdmin || isAssignedPatient || isAssignedDoctor) {
          if (fs.existsSync(filePath)) {
            return this._streamFile(res, filePath, ext, "inline");
          }
          if (s3StorageService.isConfigured()) {
            const matchedFile = appointmentWithFile.consultationFiles?.find(
              (f) => this._matchesFilename(f.url, cleanFilename)
            );
            const cleanKey = s3StorageService.extractObjectKey(matchedFile?.url || cleanFilename);
            const presignedUrl = await s3StorageService.getPresignedDownloadUrl(cleanKey, {
              bucketType: "private",
            });
            return res.redirect(302, presignedUrl);
          }
          return res.status(404).json({ success: false, message: "File not found." });
        }

        return res.status(403).json({
          success: false,
          message: "Access denied. You are not a participant in this consultation session.",
        });
      }

      // ── 6. Patient Profile Photo ───────────────────────────────────────────
      const patientWithAvatar = await Patient.findOne({
        avatarUrl: filenameRegex,
      }).select("_id avatarUrl");

      if (patientWithAvatar) {
        const sharedPatient = await SharedUser.findOne({ profileId: patientWithAvatar._id }).select("_id");
        const isOwnerPatient = sharedPatient && sharedPatient._id.toString() === userId.toString();

        // Doctor treating this patient
        let isAttendingDoctor = false;
        if (user.role === "doctor") {
          const doctorShared = await SharedUser.findById(userId).select("profileId");
          isAttendingDoctor = await Appointment.exists({
            doctorId: { $in: [doctorShared?.profileId, userId].filter(Boolean) },
            patientId: sharedPatient?._id,
            status: { $nin: ["available", "locked", "expired"] },
          });
        }

        if (isAdmin || isOwnerPatient || isAttendingDoctor) {
          if (fs.existsSync(filePath)) {
            return this._streamFile(res, filePath, ext, "inline");
          }
          if (s3StorageService.isConfigured()) {
            if (patientWithAvatar.avatarUrl?.startsWith("http://") || patientWithAvatar.avatarUrl?.startsWith("https://")) {
              return res.redirect(302, patientWithAvatar.avatarUrl);
            }
            if (patientWithAvatar.avatarUrl?.startsWith("avatars/")) {
              return res.redirect(302, s3StorageService.getCloudFrontUrl(patientWithAvatar.avatarUrl));
            }
            const cleanKey = s3StorageService.extractObjectKey(patientWithAvatar.avatarUrl || cleanFilename);
            const presignedUrl = await s3StorageService.getPresignedDownloadUrl(cleanKey, {
              bucketType: "private",
            });
            return res.redirect(302, presignedUrl);
          }
          return res.status(404).json({ success: false, message: "File not found." });
        }

        return res.status(403).json({
          success: false,
          message: "Access denied. You are not authorized to view this patient avatar.",
        });
      }

      // ── 7. Dispute Proof Documents & Evidence ───────────────────────────────
      let disputeAppointment = await Appointment.findOne({
        disputeProofUrl: filenameRegex,
      }).select("_id doctorId patientId disputeProofUrl");

      let disputeTicket = null;
      if (!disputeAppointment) {
        disputeTicket = await RefundTicket.findOne({
          proofUrl: filenameRegex,
        }).select("_id doctorId patientId proofUrl appointmentId");
      }

      const disputeDoc = disputeAppointment || disputeTicket;
      if (disputeDoc) {
        const proofField = disputeAppointment ? disputeAppointment.disputeProofUrl : disputeTicket.proofUrl;

        // Submitter / Patient ownership check
        const recordPatientId = (disputeDoc.patientId?._id || disputeDoc.patientId)?.toString();
        const sharedPatient = await SharedUser.findOne({
          $or: [
            { _id: userId },
            { profileId: userId },
          ],
        }).select("_id profileId");

        const isSubmitterPatient =
          recordPatientId === userId.toString() ||
          (sharedPatient && (
            recordPatientId === sharedPatient._id.toString() ||
            (sharedPatient.profileId && recordPatientId === sharedPatient.profileId.toString())
          ));

        // Assigned Doctor check
        let isAssignedDoctor = false;
        if (user.role === "doctor") {
          const doctorShared = await SharedUser.findById(userId).select("profileId");
          const doctorProfileId = doctorShared?.profileId;
          const recordDoctorId = (disputeDoc.doctorId?._id || disputeDoc.doctorId)?.toString();

          isAssignedDoctor =
            recordDoctorId === userId.toString() ||
            (doctorProfileId && recordDoctorId === doctorProfileId.toString());
        }

        if (isAdmin || isSubmitterPatient || isAssignedDoctor) {
          if (fs.existsSync(filePath)) {
            return this._streamFile(res, filePath, ext, "inline");
          }
          if (s3StorageService.isConfigured()) {
            const cleanKey = s3StorageService.extractObjectKey(proofField || cleanFilename);
            const presignedUrl = await s3StorageService.getPresignedDownloadUrl(cleanKey, {
              bucketType: "private",
            });
            return res.redirect(302, presignedUrl);
          }
          return res.status(404).json({ success: false, message: "File not found." });
        }

        return res.status(403).json({
          success: false,
          message: "Access denied. You are not authorized to view this dispute proof.",
        });
      }

      // ── 8. Fallback for admin or unmatched files ─────────────────────────────
      if (isAdmin && fs.existsSync(filePath)) {
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
