import fs from 'fs';

export class AdminUserController {
    constructor(
        listUsers,
        createUser,
        updateUser,
        getUser,
        deleteUser,
        restoreUser
    ) {
        this.listUsersUseCase = listUsers;
        this.createUserUseCase = createUser;
        this.updateUserUseCase = updateUser;
        this.getUserUseCase = getUser;
        this.deleteUserUseCase = deleteUser;
        this.restoreUserUseCase = restoreUser;
    }

    async getUsers(req, res) {
        try {
            const { page, limit, keyword, role, isDeleted } = req.query;
            const result = await this.listUsersUseCase.execute({ page, limit, keyword, role, isDeleted });

            // Map users to include _id for frontend compatibility
            if (result.users) {
                result.users = result.users.map(user => ({
                    ...user,
                    _id: user.id || user._id
                }));
            }

            res.json({ success: true, ...result });
        } catch (error) {
            console.error('Get Users Error:', error); // DEBUG
            fs.appendFileSync('admin_error.log', `${new Date().toISOString()} - ${error.message}\n${error.stack}\n\n`);
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async createUser(req, res) {
        try {

            const createdBy = req.user.id;
            const { name, email, password, isAdmin } = req.body;

            const user = await this.createUserUseCase.execute({ name, email, password, isAdmin, createdBy });

            // Remove sensitive data
            const userResponse = {
                _id: user.id || user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
            };

            res.status(201).json({ success: true, message: "User created successfully", user: userResponse });
        } catch (error) {
            if (error.message === 'User with this email already exists') {
                return res.status(409).json({ success: false, message: error.message });
            }
            if (error.message === 'Name, email, and password are required' || error.message === 'Password must be at least 6 characters long') {
                return res.status(400).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateUser(req, res) {
        try {
            const adminId = req.user.id;
            const id = req.params.id;
            const { name, email, password, isAdmin } = req.body;

            const updatedUser = await this.updateUserUseCase.execute({ id, name, email, password, isAdmin, adminId });

            const userResponse = {
                _id: updatedUser.id || updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                role: updatedUser.role,
                createdAt: updatedUser.createdAt,
                updatedAt: updatedUser.updatedAt
            };

            res.json({ success: true, message: "User updated successfully", user: userResponse });

        } catch (error) {
            if (error.message === 'User not found') {
                return res.status(404).json({ success: false, message: error.message });
            }
            if (error.message === 'Cannot remove admin privileges from your own account') {
                return res.status(403).json({ success: false, message: error.message });
            }
            if (error.message === 'Email already in use') {
                return res.status(409).json({ success: false, message: error.message });
            }
            // Other validation errors
            if (error.message.includes('must be')) {
                return res.status(400).json({ success: false, message: error.message });
            }

            res.status(500).json({ success: false, message: error.message });
        }
    }

    async getUserById(req, res) {
        try {
            const user = await this.getUserUseCase.execute(req.params.id);

            const userResponse = {
                _id: user.id || user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isDeleted: user.isDeleted,
                lastLogin: user.lastLogin,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
            };

            res.json({ success: true, user: userResponse });
        } catch (error) {
            if (error.message === 'User not found') {
                return res.status(404).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async deleteUser(req, res) {
        try {
            const adminId = req.user.id;
            const id = req.params.id;
            await this.deleteUserUseCase.execute({ id, adminId, hardDelete: true });
            res.json({ success: true, message: "User permanently deleted" });
        } catch (error) {
            console.error('Delete User Error:', error); // DEBUG
            if (error.message === 'User not found') {
                return res.status(404).json({ success: false, message: error.message });
            }
            if (error.message === 'Cannot delete your own account') {
                return res.status(403).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async softDeleteUser(req, res) {
        try {
            const adminId = req.user.id;
            const id = req.params.id;
            await this.deleteUserUseCase.execute({ id, adminId, hardDelete: false }); // Reuse delete logic but soft
            res.json({ success: true, message: "User deactivated successfully" });
        } catch (error) {
            if (error.message === 'User not found') {
                return res.status(404).json({ success: false, message: error.message });
            }
            if (error.message === 'Cannot deactivate your own account') {
                return res.status(403).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async restoreUser(req, res) {
        try {
            await this.restoreUserUseCase.execute(req.params.id);
            res.json({ success: true, message: "User restored successfully" });
        } catch (error) {
            console.error('Restore User Error:', error); // DEBUG
            if (error.message === 'User not found') {
                return res.status(404).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async approveDoctor(req, res) {
        try {
            const doctorId = req.params.id;
            
            const SharedUser = (await import('../../infrastructure/database/models/SharedUser.js')).default;
            const DoctorProfile = (await import('../../infrastructure/database/models/DoctorProfile.js')).default;

            const sharedUser = await SharedUser.findById(doctorId);
            if (!sharedUser || sharedUser.role !== 'doctor') {
                return res.status(404).json({ success: false, message: 'Doctor not found' });
            }

            const doctorProfile = await DoctorProfile.findById(sharedUser.profileId);
            if (doctorProfile) {
                doctorProfile.verificationStatus = 'approved';
                doctorProfile.medicalCertificateStatus = 'approved';
                doctorProfile.governmentIdStatus = 'approved';
                if (doctorProfile.qualifications && doctorProfile.qualifications.length > 0) {
                    doctorProfile.qualifications.forEach(q => {
                        q.certificateStatus = 'approved';
                    });
                }
                await doctorProfile.save();
            }

            res.json({ success: true, message: 'Doctor approved successfully' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async rejectDoctor(req, res) {
        try {
            const doctorId = req.params.id;
            
            const SharedUser = (await import('../../infrastructure/database/models/SharedUser.js')).default;
            const DoctorProfile = (await import('../../infrastructure/database/models/DoctorProfile.js')).default;

            const sharedUser = await SharedUser.findById(doctorId);
            if (!sharedUser || sharedUser.role !== 'doctor') {
                return res.status(404).json({ success: false, message: 'Doctor not found' });
            }

            const doctorProfile = await DoctorProfile.findById(sharedUser.profileId);
            if (doctorProfile) {
                doctorProfile.verificationStatus = 'rejected';
                doctorProfile.medicalCertificateStatus = 'rejected';
                doctorProfile.governmentIdStatus = 'rejected';
                if (doctorProfile.qualifications && doctorProfile.qualifications.length > 0) {
                    doctorProfile.qualifications.forEach(q => {
                        q.certificateStatus = 'rejected';
                    });
                }
                await doctorProfile.save();
            }

            res.json({ success: true, message: 'Doctor rejected successfully' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async suspendDoctor(req, res) {
        try {
            const doctorId = req.params.id;
            
            const SharedUser = (await import('../../infrastructure/database/models/SharedUser.js')).default;
            const DoctorProfile = (await import('../../infrastructure/database/models/DoctorProfile.js')).default;

            const sharedUser = await SharedUser.findById(doctorId);
            if (!sharedUser || sharedUser.role !== 'doctor') {
                return res.status(404).json({ success: false, message: 'Doctor not found' });
            }

            // Update account status directly on SharedUser
            await SharedUser.findByIdAndUpdate(doctorId, { accountStatus: 'suspended' });

            res.json({ success: true, message: 'Doctor suspended successfully' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async unsuspendDoctor(req, res) {
        try {
            const doctorId = req.params.id;
            
            const SharedUser = (await import('../../infrastructure/database/models/SharedUser.js')).default;
            const DoctorProfile = (await import('../../infrastructure/database/models/DoctorProfile.js')).default;

            const sharedUser = await SharedUser.findById(doctorId);
            if (!sharedUser || sharedUser.role !== 'doctor') {
                return res.status(404).json({ success: false, message: 'Doctor not found' });
            }

            // Re-activate account status
            await SharedUser.findByIdAndUpdate(doctorId, { accountStatus: 'active' });

            res.json({ success: true, message: 'Doctor unsuspended successfully' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateQualificationStatus(req, res) {
        try {
            const { id: doctorId, qualId } = req.params;
            const { status, reason } = req.body;
            
            const SharedUser = (await import('../../infrastructure/database/models/SharedUser.js')).default;
            const DoctorProfile = (await import('../../infrastructure/database/models/DoctorProfile.js')).default;

            const sharedUser = await SharedUser.findById(doctorId);
            if (!sharedUser || sharedUser.role !== 'doctor') {
                return res.status(404).json({ success: false, message: 'Doctor not found' });
            }

            const doctorProfile = await DoctorProfile.findById(sharedUser.profileId);
            if (!doctorProfile) {
                return res.status(404).json({ success: false, message: 'Doctor profile not found' });
            }

            const qualification = doctorProfile.qualifications.find(q => q.id === qualId);
            if (!qualification) {
                return res.status(404).json({ success: false, message: 'Qualification not found' });
            }

            qualification.certificateStatus = status;
            if (status === 'rejected') {
                qualification.rejectionReason = reason || "";
            } else if (status === 'approved') {
                qualification.rejectionReason = "";
            }

            // Check if profile should be fully approved
            if (doctorProfile.medicalCertificateStatus === 'approved' && 
                doctorProfile.governmentIdStatus === 'approved' && 
                (doctorProfile.qualifications || []).every(q => q.certificateStatus === 'approved')) {
                doctorProfile.verificationStatus = 'approved';
            }

            await doctorProfile.save();

            res.json({ success: true, message: `Qualification certificate marked as ${status}`, verificationStatus: doctorProfile.verificationStatus });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    async updateDocumentStatus(req, res) {
        try {
            const { id: doctorId, docType } = req.params;
            const { status, reason } = req.body;
            
            const SharedUser = (await import('../../infrastructure/database/models/SharedUser.js')).default;
            const DoctorProfile = (await import('../../infrastructure/database/models/DoctorProfile.js')).default;

            const sharedUser = await SharedUser.findById(doctorId);
            if (!sharedUser || sharedUser.role !== 'doctor') {
                return res.status(404).json({ success: false, message: 'Doctor not found' });
            }

            const validDocTypes = ['medicalCertificate', 'governmentId'];
            if (!validDocTypes.includes(docType)) {
                return res.status(400).json({ success: false, message: 'Invalid document type' });
            }

            const doctorProfile = await DoctorProfile.findById(sharedUser.profileId);
            if (!doctorProfile) {
                return res.status(404).json({ success: false, message: 'Doctor profile not found' });
            }

            if (docType === 'medicalCertificate') {
                doctorProfile.medicalCertificateStatus = status;
                if (status === 'rejected') {
                    doctorProfile.medicalCertificateRejectionReason = reason || "";
                } else if (status === 'approved') {
                    doctorProfile.medicalCertificateRejectionReason = "";
                }
            } else if (docType === 'governmentId') {
                doctorProfile.governmentIdStatus = status;
                if (status === 'rejected') {
                    doctorProfile.governmentIdRejectionReason = reason || "";
                } else if (status === 'approved') {
                    doctorProfile.governmentIdRejectionReason = "";
                }
            }

            // Check if profile should be fully approved
            if (doctorProfile.medicalCertificateStatus === 'approved' && 
                doctorProfile.governmentIdStatus === 'approved' && 
                (doctorProfile.qualifications || []).every(q => q.certificateStatus === 'approved')) {
                doctorProfile.verificationStatus = 'approved';
            }

            await doctorProfile.save();

            res.json({ success: true, message: `Document marked as ${status}`, verificationStatus: doctorProfile.verificationStatus });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
}