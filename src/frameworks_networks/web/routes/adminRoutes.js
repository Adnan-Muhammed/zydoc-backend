import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { adminOnly } from '../middleware/adminMiddleware.js';

// Frameworks & Drivers
import UserModel from '../../database/models/UserModel.js';

// Interface Adapters
import { MongoUserRepository } from '../../../interface_adapters/storage/MongoUserRepository.js';
import { JwtService } from '../../../interface_adapters/security/JwtService.js';
import { BcryptService } from '../../../interface_adapters/security/BcryptService.js';
import { AdminUserController } from '../../../interface_adapters/controllers/AdminUserController.js';

// Use Cases        
import { ListUsers } from '../../../usecases/admin/ListUsers.js';
import { CreateUser } from '../../../usecases/admin/CreateUser.js';
import { UpdateUser } from '../../../usecases/admin/UpdateUser.js';
import { GetUser } from '../../../usecases/admin/GetUser.js';
import { DeleteUser } from '../../../usecases/admin/DeleteUser.js'; // Handles both soft and hard delete logic if designed that way
import { RestoreUser } from '../../../usecases/admin/RestoreUser.js';

const router = express.Router();

// Dependency Injection
const userRepository = new MongoUserRepository();
const bcryptService = new BcryptService();
const jwtService = new JwtService();

const authService = {
    hashPassword: (pwd) => bcryptService.hashPassword(pwd),
    comparePassword: (pwd, hash) => bcryptService.comparePassword(pwd, hash),
    generateAccessToken: (user) => jwtService.generateAccessToken(user),
    generateRefreshToken: (user) => jwtService.generateRefreshToken(user),
};

const listUsersUseCase = new ListUsers(userRepository);
const createUserUseCase = new CreateUser(userRepository, authService);
const updateUserUseCase = new UpdateUser(userRepository, authService);
const getUserUseCase = new GetUser(userRepository);
const deleteUserUseCase = new DeleteUser(userRepository); // My DeleteUser usecase handles both logic based on flag
const restoreUserUseCase = new RestoreUser(userRepository);


const adminUserController = new AdminUserController(
    listUsersUseCase,
    createUserUseCase,
    updateUserUseCase,
    getUserUseCase,
    deleteUserUseCase,
    restoreUserUseCase
);

// Routes
// Apply middleware to all routes
router.use(protect, adminOnly);

router.get('/', (req, res) => adminUserController.getUsers(req, res));
router.get('/:id', (req, res) => adminUserController.getUserById(req, res));
router.post('/', (req, res) => adminUserController.createUser(req, res));
router.put('/:id', (req, res) => adminUserController.updateUser(req, res));
router.put('/soft-delete/:id', (req, res) => adminUserController.softDeleteUser(req, res));
router.put('/restore/:id', (req, res) => adminUserController.restoreUser(req, res));
router.delete('/:id', (req, res) => adminUserController.deleteUser(req, res));

export default router;
