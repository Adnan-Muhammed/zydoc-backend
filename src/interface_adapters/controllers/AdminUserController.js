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
        console.log('AdminUserController.getUsers: entered'); // TRACE
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
            // req.user.id is the admin creating the user
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
        // Hard delete
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
}