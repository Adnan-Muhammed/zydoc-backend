// // src/presentation/controllers/DoctorController.js

// export class DoctorController {
//   constructor(updateDoctorProfileUseCase) {
//     this.updateDoctorProfileUseCase = updateDoctorProfileUseCase;
//   } 

//   async updateProfile(req, res) {
//     try {
//       const userId = req.user?.id;
import mongoose from "mongoose";
import { validateWorkingHours } from "../../infrastructure/utils/scheduleValidator.js";
import { deduceSystemOfMedicine, normalizeSystemOfMedicine } from "../../infrastructure/utils/systemOfMedicineHelper.js";
import Appointment from "../../infrastructure/database/models/Appointment.js";
import SharedUser from "../../infrastructure/database/models/SharedUser.js";
import Doctor from "../../infrastructure/database/models/DoctorProfile.js";
import { MongoReviewRepository } from "../../modules/reviews-ratings/repositories/MongoReviewRepository.js";

export class DoctorController {
    constructor(updateDoctorProfileUseCase, jwtService, patchDoctorProfileUseCase, uploadDoctorDocuments, getDoctorProfile, updateFcmToken, getDoctorEarningsUseCase, updateBankDetailsUseCase) {
        this.updateDoctorProfileUseCase = updateDoctorProfileUseCase;
        this.jwtService = jwtService;
        this.patchDoctorProfileUseCase = patchDoctorProfileUseCase;
        this.uploadDoctorDocuments = uploadDoctorDocuments;
        this.getDoctorProfile = getDoctorProfile;
        this.updateFcmToken = updateFcmToken;
        this.getDoctorEarningsUseCase = getDoctorEarningsUseCase;
        this.updateBankDetailsUseCase = updateBankDetailsUseCase;
    }

    async updateProfile(req, res) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            let profileData = {};
            try {
                profileData = JSON.parse(req.body.data);
            } catch (e) {
                return res.status(400).json({ success: false, message: "Invalid profile data format" });
            }

            const updatedDoctor = await this.updateDoctorProfileUseCase.execute(
                userId,
                profileData,
                req.files
            );

            const mappedUser = this._mapUserResponse(updatedDoctor);

            const newAccessToken = this.jwtService.generateAccessToken({
                id: mappedUser._id,
                role: mappedUser.role,
                isProfileCompleted: true,
            });

            //   this line cuurently 2 minutes 
            // but i want to be 15 minutes
            res.cookie('accessToken', newAccessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 15 * 60 * 1000,
            });

            res.status(200).json({
                success: true,
                message: "Profile updated successfully",
                user: mappedUser,
            });

        } catch (error) {
            console.error("Error updating profile:", error);

            const statusCode = this._isClientError(error) ? 400 : 500;
            const field = this._getErrorField(error);

            res.status(statusCode).json({
                success: false,
                message: error.message || "Failed to update profile",
                ...(field && { field }),
            });
        }
    }

    async _handlePatch(req, res, buildDataFn) {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const partialData = buildDataFn(req);
            const updatedDoctor = await this.patchDoctorProfileUseCase.execute(userId, partialData, req.files);

            res.status(200).json({
                success: true,
                message: "Section updated successfully",
                user: this._mapUserResponse(updatedDoctor),
                profile: updatedDoctor
            });
        } catch (error) {
            console.error("Error updating profile section:", error);
            const statusCode = this._isClientError(error) ? 400 : 500;
            const field = this._getErrorField(error);
            res.status(statusCode).json({
                success: false,
                message: error.message || "Failed to update profile section",
                ...(field && { field }),
            });
        }
    }

    async updateBasicInfo(req, res) {
        return this._handlePatch(req, res, (req) => {
            const body = { ...req.body };
            if (body.systemOfMedicine) {
                body.systemOfMedicine = normalizeSystemOfMedicine(body.systemOfMedicine) || body.systemOfMedicine;
            }
            return body;
        });
    }

    async updateConsultation(req, res) {
        return this._handlePatch(req, res, (req) => {
            const body = req.body || {};
            const isOnline = body.online?.enabled ?? body.enableVideo ?? false;
            const onlineFee = Number(body.online?.fee ?? body.videoFee ?? 0);
            const isOffline = body.offline?.enabled ?? body.enablePhysical ?? false;
            const offlineFee = Number(body.offline?.fee ?? body.physicalFee ?? 0);
            const clinicName = body.offline?.clinicName ?? body.clinicName ?? "";
            const clinicAddress = body.offline?.clinicAddress ?? body.clinicAddress ?? "";

            return {
                consultationSettings: {
                    online: { enabled: Boolean(isOnline), fee: onlineFee },
                    offline: { enabled: Boolean(isOffline), fee: offlineFee, clinicName, clinicAddress }
                }
            };
        });
    }

    async updateQualifications(req, res) {
        return this._handlePatch(req, res, (req) => {
            let qualifications = [];
            try {
                qualifications = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : (req.body.qualifications || []);
            } catch (e) {
                throw new Error("Invalid qualifications format");
            }

            if (!Array.isArray(qualifications)) qualifications = [];

            const files = req.files || [];

            for (let q of qualifications) {
                const file = files.find(f => f.fieldname === `certificate_${q.id}`);
                if (file) {
                    q.certificateUrl = `/uploads/${file.filename}`;
                    q.certificateStatus = 'pending';
                }
            }

            const patchPayload = { qualifications };
            const deducedSystem = deduceSystemOfMedicine(qualifications);
            if (deducedSystem) {
                patchPayload.systemOfMedicine = deducedSystem;
            }

            return patchPayload;
        });
    }

    async updatePreferences(req, res) {
        return this._handlePatch(req, res, (req) => ({
            languages: req.body.selectedLanguages,
            expertiseTags: req.body.expertiseTags
        }));
    }

    async updateSchedule(req, res) {
        try {
            const userId = req.user?.id || req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const slotDuration = Number(req.body.slotDuration) || 15;
            const { workingHours, forceUpdate, timezone } = req.body;

            validateWorkingHours(workingHours, slotDuration);

            // Check for upcoming active bookings if forceUpdate is not true
            if (!forceUpdate) {
                const user = await SharedUser.findById(userId);
                const doctorProfileId = user?.profileId;

                if (doctorProfileId) {
                    const now = new Date();
                    const startOfToday = new Date(now.setHours(0, 0, 0, 0));

                    const hasUpcoming = await Appointment.exists({
                        doctorId: doctorProfileId,
                        appointmentDate: { $gte: startOfToday },
                        status: { $in: ['scheduled', 'locked'] }
                    });

                    if (hasUpcoming) {
                        return res.status(409).json({
                            success: false,
                            conflict: true,
                            message: "You have upcoming consultations. Changing the schedule times or duration may cause time lapses and irregular slots around your existing bookings. Do you want to proceed anyway?"
                        });
                    }
                }
            }

            const updatePayload = {
                workingHours,
                slotDuration
            };
            if (timezone && typeof timezone === 'string') {
                updatePayload.timezone = timezone.trim();
            }

            const updatedDoctor = await this.patchDoctorProfileUseCase.execute(userId, updatePayload, req.files);

            return res.status(200).json({
                success: true,
                message: "Schedule updated successfully",
                user: this._mapUserResponse(updatedDoctor),
                profile: updatedDoctor
            });
        } catch (error) {
            console.error("Error updating schedule:", error);
            const statusCode = this._isClientError(error) ? 400 : 500;
            const field = this._getErrorField(error);
            return res.status(statusCode).json({
                success: false,
                message: error.message || "Failed to update schedule",
                ...(field && { field }),
            });
        }
    }

    async uploadCertificates(req, res) {
        return this._handlePatch(req, res, (req) => {
            return {}; // Model doesn't support generic certificates directly.
        });
    }

    async getProfile(req, res) {
        try {
            const userId = req.user?.id || req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const profile = await this.getDoctorProfile.execute(userId);

            res.status(200).json({
                success: true,
                profile
            });
        } catch (error) {
            console.error("Error fetching doctor profile:", error);
            res.status(400).json({
                success: false,
                message: error.message || "Failed to fetch profile"
            });
        }
    }

    /**
     * PATCH /doctors/fcm-token
     * Receives the FCM registration token from the frontend and persists it
     * on the authenticated doctor's profile for push notification delivery.
     */
    async saveFcmToken(req, res) {
        try {
            const userId = req.user?.id || req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const { fcmToken } = req.body;

            // Allow explicit null to clear/unregister the token (e.g. on logout)
            if (fcmToken !== null && (typeof fcmToken !== "string" || fcmToken.trim() === "")) {
                return res.status(400).json({ success: false, message: "A valid fcmToken string is required." });
            }

            await this.updateFcmToken.execute(userId, fcmToken);

            return res.status(200).json({
                success: true,
                message: fcmToken ? "FCM token registered successfully." : "FCM token cleared.",
            });
        } catch (error) {
            console.error("[DoctorController] Error saving FCM token:", error.message);
            const statusCode = error.message === "User not found." ? 404 : 500;
            return res.status(statusCode).json({
                success: false,
                message: error.message || "Failed to save FCM token.",
            });
        }
    }

    async getEarnings(req, res) {
        try {
            const userId = req.user?.id || req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 10;

            const earningsData = await this.getDoctorEarningsUseCase.execute(userId, { page, limit });

            return res.status(200).json({
                success: true,
                ...earningsData
            });
        } catch (error) {
            console.error("[DoctorController] Error getting earnings:", error);
            return res.status(500).json({
                success: false,
                message: error.message || "Failed to fetch earnings"
            });
        }
    }

    async updateBankDetails(req, res) {
        try {
            const userId = req.user?.id || req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const bankDetails = req.body;
            const updatedBankDetails = await this.updateBankDetailsUseCase.execute(userId, bankDetails);

            return res.status(200).json({
                success: true,
                message: "Bank details updated successfully",
                bankDetails: updatedBankDetails
            });
        } catch (error) {
            console.error("[DoctorController] Error updating bank details:", error);
            return res.status(400).json({
                success: false,
                message: error.message || "Failed to update bank details"
            });
        }
    }

    async getDashboardStats(req, res) {
        try {
            const userId = req.user?.id || req.user?._id;
            if (!userId) {
                return res.status(401).json({ success: false, message: "Unauthorized" });
            }

            const sharedUser = await SharedUser.findById(userId);
            if (!sharedUser || !sharedUser.profileId) {
                return res.status(404).json({ success: false, message: "Doctor profile not found" });
            }

            const doctorProfileId = sharedUser.profileId;
            const doctorProfile = await Doctor.findById(doctorProfileId);

            // 1. Total Distinct Patients
            const uniquePatientIds = await Appointment.distinct("patientId", {
                doctorId: doctorProfileId,
                patientId: { $ne: null }
            });
            const totalPatients = uniquePatientIds.length;

            // 2. Appointment Aggregations & Status Breakdown
            const appointmentStatusAgg = await Appointment.aggregate([
                { $match: { doctorId: new mongoose.Types.ObjectId(doctorProfileId) } },
                { $group: { _id: "$status", count: { $sum: 1 } } }
            ]);

            let totalAppointments = 0;
            let completedAppointments = 0;
            let upcomingAppointments = 0;
            let cancelledAppointments = 0;

            appointmentStatusAgg.forEach(item => {
                if (item._id !== 'locked' && item._id !== 'expired') {
                    totalAppointments += item.count;
                }
                if (item._id === 'completed') {
                    completedAppointments += item.count;
                } else if (['scheduled', 'in_progress', 'patient joined', 'time reached'].includes(item._id)) {
                    upcomingAppointments += item.count;
                } else if (['cancelled', 'cancelled_by_doctor', 'cancelled_by_admin', 'doctor_missed', 'refunded'].includes(item._id)) {
                    cancelledAppointments += item.count;
                }
            });

            // 3. Total Earnings (Settled, Pending, Total)
            let earningsSummary = {
                pendingEarnings: 0,
                settledEarnings: 0,
                totalEarnings: 0,
                pendingCount: 0,
                settledCount: 0
            };
            if (this.getDoctorEarningsUseCase) {
                try {
                    const earningsData = await this.getDoctorEarningsUseCase.execute(userId);
                    if (earningsData?.summary) {
                        earningsSummary = earningsData.summary;
                    }
                } catch (e) {
                    console.warn("[DoctorController.getDashboardStats] Earnings calculation warning:", e.message);
                }
            }

            // 4. Rating & Reviews Breakdown
            const reviewRepo = new MongoReviewRepository();
            let averageRating = doctorProfile?.rating || 0;
            let totalReviews = doctorProfile?.reviewCount || 0;
            let starCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            let breakdownPercentages = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

            try {
                const ratingData = await reviewRepo.getDoctorRatingBreakdown(doctorProfileId);
                if (ratingData) {
                    averageRating = ratingData.averageRating || 0;
                    totalReviews = ratingData.totalReviews || 0;
                    starCounts = ratingData.starCounts || starCounts;
                    breakdownPercentages = ratingData.breakdownPercentages || breakdownPercentages;
                }
            } catch (e) {
                console.warn("[DoctorController.getDashboardStats] Review aggregation warning:", e.message);
            }

            const positiveReviewsCount = (starCounts[4] || 0) + (starCounts[5] || 0);
            const satisfactionRate = totalReviews > 0 ? Math.round((positiveReviewsCount / totalReviews) * 100) : (totalAppointments > 0 ? 100 : 0);
            const qualityScore = averageRating > 0 ? Math.round((averageRating / 5) * 100) : (totalAppointments > 0 ? 100 : 0);

            // 5. Consultation Settings & Availability
            const onlineSettings = doctorProfile?.consultationSettings?.online || { enabled: true, fee: 0 };
            const offlineSettings = doctorProfile?.consultationSettings?.offline || { enabled: false, fee: 0, clinicName: '', clinicAddress: '' };

            return res.status(200).json({
                success: true,
                stats: {
                    totalPatients,
                    totalAppointments,
                    completedAppointments,
                    upcomingAppointments,
                    cancelledAppointments,
                    totalEarnings: earningsSummary.totalEarnings || 0,
                    settledEarnings: earningsSummary.settledEarnings || 0,
                    pendingEarnings: earningsSummary.pendingEarnings || 0,
                    rating: averageRating,
                    totalReviews,
                    starCounts,
                    breakdownPercentages,
                    satisfactionRate,
                    qualityScore,
                    consultationSettings: {
                        online: onlineSettings,
                        offline: offlineSettings
                    }
                }
            });
        } catch (error) {
            console.error("[DoctorController.getDashboardStats] Error:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to retrieve doctor dashboard stats",
                error: error.message
            });
        }
    }

    _isClientError(error) {
        const clientErrors = [
            "User not found",
            "User is not a doctor",
            "The phone number you provided is already linked to another doctor profile.",
            "The medical license number you entered is already registered in our system.",
        ];
        return clientErrors.includes(error.message);
    }

    _getErrorField(error) {
        const fieldMap = {
            "The phone number you provided is already linked to another doctor profile.": "phone",
            "The medical license number you entered is already registered in our system.": "licenseNumber",
        };
        return fieldMap[error.message] || null;
    }

    _mapUserResponse(user) {
        return {
            _id: user.id || user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            isProfileCompleted: user.isProfileCompleted || false,
            verificationStatus: user.verificationStatus || 'pending',
            isDeleted: user.isDeleted,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            lastLogin: user.lastLogin,
        };
    }
}