export class UserController {
    constructor(getUserProfile, updateUserProfile) {
        this.getUserProfile = getUserProfile;
        this.updateUserProfile = updateUserProfile;
    }

    async getProfile(req, res) {
        try {
            const userId = req.user.id;
            const user = await this.getUserProfile.execute(userId);

            const userResponse = {
                _id: user.id || user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
            };

            if (user.role === 'doctor') {
                userResponse.medicalCertificateStatus = user.medicalCertificateStatus;
                userResponse.medicalCertificateRejectionReason = user.medicalCertificateRejectionReason;
                userResponse.governmentIdStatus = user.governmentIdStatus;
                userResponse.governmentIdRejectionReason = user.governmentIdRejectionReason;
                userResponse.qualifications = user.qualifications;
            }

            res.json({ success: true, user: userResponse });
        } catch (error) {
            if (error.message === 'User not found' || error.message === 'Your account has been deactivated') {
                return res.status(404).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateProfile(req, res) {
        try {
            const userId = req.user.id;
            const { name, email, currentPassword, newPassword } = req.body;

            const updatedUser = await this.updateUserProfile.execute({
                userId,
                name,
                email,
                currentPassword,
                newPassword
            });

            const userResponse = {
                _id: updatedUser.id || updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                role: updatedUser.role,
                createdAt: updatedUser.createdAt,
                updatedAt: updatedUser.updatedAt
            };

            if (updatedUser.role === 'doctor') {
                userResponse.medicalCertificateStatus = updatedUser.medicalCertificateStatus;
                userResponse.medicalCertificateRejectionReason = updatedUser.medicalCertificateRejectionReason;
                userResponse.governmentIdStatus = updatedUser.governmentIdStatus;
                userResponse.governmentIdRejectionReason = updatedUser.governmentIdRejectionReason;
                userResponse.qualifications = updatedUser.qualifications;
            }

            res.json({ success: true, message: "Profile updated successfully", user: userResponse });
        } catch (error) {
            const clientErrors = [
                'Name must be at least 2 characters long',
                'Email already in use',
                'Current password is required to set a new password',
                'Current password is incorrect',
                'New password must be at least 6 characters long'
            ];

            if (clientErrors.includes(error.message)) {
                return res.status(400).json({ success: false, message: error.message });
            }

            if (error.message === 'User not found') {
                return res.status(404).json({ success: false, message: error.message });
            }

            res.status(500).json({ success: false, message: error.message });
        }
    }
}
