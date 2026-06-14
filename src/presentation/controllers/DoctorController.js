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
//       }

//       let profileData = {};
//       try {
//         profileData = JSON.parse(req.body.data);
//       } catch (e) {
//         return res.status(400).json({ success: false, message: "Invalid profile data format" });
//       }

//       const updatedDoctor = await this.updateDoctorProfileUseCase.execute(
//         userId,
//         profileData,
//         req.files
//       );

//       res.status(200).json({
//         success: true,
//         message: "Profile updated successfully",
//         user: this._mapUserResponse(updatedDoctor),
//       });
//     } catch (error) {
//       console.error("Error updating profile:", error);
//       res.status(500).json({
//         success: false,
//         message: error.message || "Failed to update profile",
//       });
//     }
//   }

//   _mapUserResponse(user) {
//     return {
//       _id: user.id || user._id,
//       name: user.name,
//       email: user.email,
//       role: user.role,
//       isProfileCompleted: user.isProfileCompleted || false,
//       verificationStatus: user.verificationStatus || 'pending',
//       isDeleted: user.isDeleted,
//       createdAt: user.createdAt,
//       updatedAt: user.updatedAt,
//       lastLogin: user.lastLogin,
//     };
//   }
// }









// src/presentation/controllers/DoctorController.js

// export class DoctorController {
//   constructor(updateDoctorProfileUseCase, jwtService) {  // ← add jwtService
//     this.updateDoctorProfileUseCase = updateDoctorProfileUseCase;
//     this.jwtService = jwtService;  // ← store it
//   }

//   async updateProfile(req, res) {
//     try {
//       const userId = req.user?.id;
//       if (!userId) {
//         return res.status(401).json({ success: false, message: "Unauthorized" });
//       }

//       let profileData = {};
//       try {
//         profileData = JSON.parse(req.body.data);
//       } catch (e) {
//         return res.status(400).json({ success: false, message: "Invalid profile data format" });
//       }

//       const updatedDoctor = await this.updateDoctorProfileUseCase.execute(
//         userId,
//         profileData,
//         req.files
//       );

//       const mappedUser = this._mapUserResponse(updatedDoctor);

//       // ✅ Issue a fresh accessToken with isProfileCompleted: true
//       const newAccessToken = this.jwtService.generateAccessToken({
//         id: mappedUser._id,
//         role: mappedUser.role,
//         isProfileCompleted: true,        // ← this is what middleware reads
//       });

//       // ✅ Set the new cookie — same settings as your login/refresh
//       res.cookie('accessToken', newAccessToken, {
//         httpOnly: true,
//         secure: process.env.NODE_ENV === 'production',
//         sameSite: 'lax',
//         path: '/',
//         maxAge: 2 * 60 * 1000,          // 2 minutes in ms (cookie uses ms, not seconds)
//       });

//       res.status(200).json({
//         success: true,
//         message: "Profile updated successfully",
//         user: mappedUser,
//       });

//     } catch (error) {
//       console.error("Error updating profile:", error);
//       res.status(500).json({
//         success: false,
//         message: error.message || "Failed to update profile",
//       });
//     }
//   }

//   _mapUserResponse(user) {
//     return {
//       _id: user.id || user._id,
//       name: user.name,
//       email: user.email,
//       role: user.role,
//       isProfileCompleted: user.isProfileCompleted || false,
//       verificationStatus: user.verificationStatus || 'pending',
//       isDeleted: user.isDeleted,
//       createdAt: user.createdAt,
//       updatedAt: user.updatedAt,
//       lastLogin: user.lastLogin,
//     };
//   }
// }



// src/presentation/controllers/DoctorController.js
export class DoctorController {
    constructor(updateDoctorProfileUseCase, jwtService) {
        this.updateDoctorProfileUseCase = updateDoctorProfileUseCase;
        this.jwtService = jwtService;
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

            res.cookie('accessToken', newAccessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 2 * 60 * 1000,
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