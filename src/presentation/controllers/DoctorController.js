// // src/presentation/controllers/DoctorController.js

// export class DoctorController {
//   constructor(updateDoctorProfileUseCase) {
//     this.updateDoctorProfileUseCase = updateDoctorProfileUseCase;
//   } 

//   async updateProfile(req, res) {
//     try {
//       const userId = req.user?.id;
//       if (!userId) {
//         return res.status(401).json({ success: false, message: "Unauthorized" });
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
        return this._handlePatch(req, res, (req) => req.body);
    }

    async updateConsultation(req, res) {
        return this._handlePatch(req, res, (req) => {
            const { enableVideo, videoFee, enablePhysical, physicalFee, clinicName, clinicAddress } = req.body;
            return {
                consultationSettings: {
                    video: { enabled: enableVideo, fee: videoFee },
                    physical: { enabled: enablePhysical, fee: physicalFee, clinicName, clinicAddress }
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

            return { qualifications };
        });
    }

    async updatePreferences(req, res) {
        return this._handlePatch(req, res, (req) => ({
            languages: req.body.selectedLanguages,
            expertiseTags: req.body.expertiseTags
        }));
    }

    async updateSchedule(req, res) {
        return this._handlePatch(req, res, (req) => ({ workingHours: req.body.workingHours }));
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