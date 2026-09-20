// src/presentation/controllers/DoctorPatientsController.js
import mongoose from "mongoose";
import Appointment from "../../infrastructure/database/models/Appointment.js";
import SharedUser from "../../infrastructure/database/models/SharedUser.js";
import Doctor from "../../infrastructure/database/models/DoctorProfile.js";
import Patient from "../../infrastructure/database/models/PatientProfile.js";

export class DoctorPatientsController {
  /**
   * GET /api/doctor/my-patients
   * Returns unique patients who have had at least one 'completed' appointment with this doctor.
   * Supports ?search= query for name, email, or phone.
   */
  async getMyPatients(req, res) {
    try {
      const userId = req.user?.id || req.user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized. User ID missing." });
      }

      const doctorSharedUser = await SharedUser.findById(userId);
      if (!doctorSharedUser || !doctorSharedUser.profileId) {
        return res.status(404).json({ success: false, message: "Doctor profile not found." });
      }
      const doctorProfileId = doctorSharedUser.profileId;

      const { search } = req.query;

      const pipeline = [
        {
          $match: {
            doctorId: new mongoose.Types.ObjectId(doctorProfileId),
            status: "completed",
            patientId: { $ne: null }
          }
        },
        {
          $sort: { appointmentDate: -1, createdAt: -1 }
        },
        {
          $group: {
            _id: "$patientId",
            totalCompletedAppointments: { $sum: 1 },
            lastAppointmentDate: { $first: "$appointmentDate" },
            lastAppointmentTime: { $first: "$appointmentTime" },
            lastConsultationType: { $first: "$consultationType" },
            lastAppointmentId: { $first: "$_id" }
          }
        },
        {
          $lookup: {
            from: "sharedusers",
            localField: "_id",
            foreignField: "_id",
            as: "sharedUser"
          }
        },
        {
          $unwind: { path: "$sharedUser", preserveNullAndEmptyArrays: true }
        },
        {
          $lookup: {
            from: "patients",
            localField: "sharedUser.profileId",
            foreignField: "_id",
            as: "patientProfile"
          }
        },
        {
          $unwind: { path: "$patientProfile", preserveNullAndEmptyArrays: true }
        },
        {
          $project: {
            _id: "$_id",
            patientId: "$_id",
            email: { $ifNull: ["$sharedUser.email", ""] },
            firstName: { $ifNull: ["$patientProfile.firstName", ""] },
            lastName: { $ifNull: ["$patientProfile.lastName", ""] },
            name: {
              $cond: {
                if: {
                  $and: [
                    { $gt: [{ $strLenCP: { $ifNull: ["$patientProfile.firstName", ""] } }, 0] },
                    { $gt: [{ $strLenCP: { $ifNull: ["$patientProfile.lastName", ""] } }, 0] }
                  ]
                },
                then: { $concat: ["$patientProfile.firstName", " ", "$patientProfile.lastName"] },
                else: {
                  $ifNull: [
                    "$patientProfile.firstName",
                    { $ifNull: ["$sharedUser.googleName", "$sharedUser.email"] }
                  ]
                }
              }
            },
            phone: { $ifNull: ["$patientProfile.phone", ""] },
            gender: { $ifNull: ["$patientProfile.gender", ""] },
            bloodGroup: { $ifNull: ["$patientProfile.bloodGroup", ""] },
            dateOfBirth: "$patientProfile.dateOfBirth",
            avatarUrl: { $ifNull: ["$patientProfile.avatarUrl", "$sharedUser.googleAvatarUrl"] },
            totalCompletedAppointments: 1,
            lastAppointmentDate: 1,
            lastAppointmentTime: 1,
            lastConsultationType: 1,
            lastAppointmentId: 1
          }
        },
        {
          $sort: { lastAppointmentDate: -1 }
        }
      ];

      if (search && typeof search === "string" && search.trim()) {
        const regex = new RegExp(search.trim(), "i");
        pipeline.push({
          $match: {
            $or: [
              { name: regex },
              { email: regex },
              { phone: regex },
              { firstName: regex },
              { lastName: regex }
            ]
          }
        });
      }

      const patients = await Appointment.aggregate(pipeline);

      return res.status(200).json({
        success: true,
        count: patients.length,
        patients
      });
    } catch (error) {
      console.error("[DoctorPatientsController.getMyPatients] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve doctor patients list.",
        error: error.message
      });
    }
  }

  /**
   * GET /api/doctor/my-patients/:patientId/history
   * STRICT PRIVACY FILTER:
   * Enforces `{ doctorId: req.user.profileId, patientId: req.params.patientId }`.
   * A doctor can NEVER see consultations, prescriptions, or notes written by other doctors!
   */
  async getPatientHistory(req, res) {
    try {
      const { patientId } = req.params;
      if (!patientId || !mongoose.Types.ObjectId.isValid(patientId)) {
        return res.status(400).json({ success: false, message: "A valid Patient ID is required." });
      }

      const userId = req.user?.id || req.user?._id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Unauthorized. User ID missing." });
      }

      const doctorSharedUser = await SharedUser.findById(userId);
      if (!doctorSharedUser || !doctorSharedUser.profileId) {
        return res.status(404).json({ success: false, message: "Doctor profile not found." });
      }
      const doctorProfileId = doctorSharedUser.profileId;

      // 1. Retrieve Patient Demographics Overview
      const patientSharedUser = await SharedUser.findById(patientId).populate("profileId");
      if (!patientSharedUser) {
        return res.status(404).json({ success: false, message: "Patient not found." });
      }
      const profile = patientSharedUser.profileId || {};
      const patientData = {
        id: patientSharedUser._id,
        patientId: patientSharedUser._id,
        name: `${profile.firstName || ""} ${profile.lastName || ""}`.trim() || patientSharedUser.googleName || patientSharedUser.email,
        email: patientSharedUser.email,
        phone: profile.phone || "Not Provided",
        gender: profile.gender || "Not Specified",
        bloodGroup: profile.bloodGroup || "Not Specified",
        dateOfBirth: profile.dateOfBirth || null,
        avatarUrl: profile.avatarUrl || patientSharedUser.googleAvatarUrl || "",
        allergies: Array.isArray(profile.medicalHistory?.allergies) ? profile.medicalHistory.allergies : [],
        chronicConditions: Array.isArray(profile.medicalHistory?.chronicConditions) ? profile.medicalHistory.chronicConditions : [],
        currentMedications: Array.isArray(profile.medicalHistory?.currentMedications) ? profile.medicalHistory.currentMedications : [],
        emergencyContact: profile.emergencyContact || null,
      };

      // 2. Strict Privacy-Filtered Consultations Query
      const appointments = await Appointment.find({
        doctorId: doctorProfileId,
        patientId: new mongoose.Types.ObjectId(patientId),
      })
        .sort({ appointmentDate: -1, createdAt: -1 })
        .select(
          "appointmentDate appointmentTime consultationType status fee feeBreakdown clinicalNotes prescriptions consultationFiles sessionStartedAt sessionEndedAt cancellationReason createdAt"
        )
        .lean();

      return res.status(200).json({
        success: true,
        patient: patientData,
        totalVisits: appointments.length,
        consultations: appointments.map((app) => ({
          id: app._id,
          appointmentId: app._id,
          appointmentDate: app.appointmentDate,
          appointmentTime: app.appointmentTime,
          consultationType: app.consultationType,
          status: app.status,
          fee: app.feeBreakdown?.totalFee || app.fee || 0,
          clinicalNotes: app.clinicalNotes || "",
          prescriptions: app.prescriptions || [],
          consultationFiles: app.consultationFiles || [],
          sessionStartedAt: app.sessionStartedAt,
          sessionEndedAt: app.sessionEndedAt,
          createdAt: app.createdAt
        }))
      });
    } catch (error) {
      console.error("[DoctorPatientsController.getPatientHistory] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve patient consultation history.",
        error: error.message
      });
    }
  }
}
