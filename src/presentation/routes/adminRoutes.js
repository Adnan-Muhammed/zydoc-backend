import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { adminOnly } from '../middleware/adminMiddleware.js';
import os from 'os';
import { systemMetrics } from '../../infrastructure/monitoring/metrics.js';

// Interface Adapters
import { MongoUserRepository } from '../../infrastructure/repositories/MongoUserRepository.js';
import { MongoTransactionRepository } from '../../infrastructure/repositories/MongoTransactionRepository.js';
import { BcryptService } from '../../infrastructure/security/BcryptService.js';
import { JwtService } from '../../infrastructure/security/JwtService.js';
import { AdminUserController } from '../../presentation/controllers/AdminUserController.js';
import { AdminController } from '../../presentation/controllers/AdminController.js';
import { getDisputedAppointmentsAdmin, refundDisputedAppointmentAdmin } from '../../presentation/controllers/AppointmentController.js';

// Use Cases        
import { ListUsers } from '../../application/usecases/admin/ListUsers.js';
import { CreateUser } from '../../application/usecases/admin/CreateUser.js';
import { UpdateUser } from '../../application/usecases/admin/UpdateUser.js';
import { GetUser } from '../../application/usecases/admin/GetUser.js';
import { DeleteUser } from '../../application/usecases/admin/DeleteUser.js'; // Handles both soft and hard delete logic if designed that way
import { RestoreUser } from '../../application/usecases/admin/RestoreUser.js';
import { GetAllTransactions } from '../../application/usecases/admin/GetAllTransactions.js';
import { SettleDoctorPayout } from '../../application/usecases/admin/SettleDoctorPayout.js';

const router = express.Router();

// Dependency Injection
const userRepository = new MongoUserRepository();
const transactionRepository = new MongoTransactionRepository();
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

const getAllTransactionsUseCase = new GetAllTransactions(transactionRepository);
const settleDoctorPayoutUseCase = new SettleDoctorPayout(transactionRepository);

const adminUserController = new AdminUserController(
    listUsersUseCase,
    createUserUseCase,
    updateUserUseCase,
    getUserUseCase,
    deleteUserUseCase,
    restoreUserUseCase
);

const adminController = new AdminController(
    getAllTransactionsUseCase,
    settleDoctorPayoutUseCase
);

// Routes
// Apply middleware to all routes
router.use(protect, adminOnly);

// System Health & Logs Routes
router.get('/health', (req, res) => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsage = (usedMem / totalMem) * 100;
    
    // CPU load average over 1 min (os.loadavg()[0]), relative to logical cores
    const cpus = os.cpus().length;
    const cpuLoad = (os.loadavg()[0] / cpus) * 100;
    
    const uptimeSeconds = process.uptime();
    const uptimeStr = `${Math.floor(uptimeSeconds / 3600)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`;

    const errorRate = systemMetrics.totalRequests > 0 
        ? ((systemMetrics.failedRequests / systemMetrics.totalRequests) * 100)
        : 0;
        
    res.json({
        serverLoad: cpuLoad > 100 ? 100 : cpuLoad,
        memoryUsage: memUsage,
        uptime: uptimeStr,
        uptimeSeconds: uptimeSeconds,
        latency: systemMetrics.averageResponseTime,
        errorRate: errorRate,
        totalRequests: systemMetrics.totalRequests,
        failedRequests: systemMetrics.failedRequests,
        status: errorRate > 5 ? 'Warning' : 'Healthy'
    });
});

router.get('/logs', (req, res) => {
    res.json(systemMetrics.recentLogs);
});

// Transactions & Payouts Routes
router.get('/transactions', (req, res) => adminController.getTransactions(req, res));
router.patch('/transactions/:id/settle', (req, res) => adminController.settleTransaction(req, res));

// Appointments Dispute & Refund Routes
router.get('/appointments/disputed', getDisputedAppointmentsAdmin);
router.post('/appointments/:id/refund', refundDisputedAppointmentAdmin);

// User Management Routes
router.get('/', (req, res) => adminUserController.getUsers(req, res));
router.get('/:id', (req, res) => adminUserController.getUserById(req, res));
router.post('/', (req, res) => adminUserController.createUser(req, res));
router.put('/:id', (req, res) => adminUserController.updateUser(req, res));
router.put('/soft-delete/:id', (req, res) => adminUserController.softDeleteUser(req, res));
router.put('/restore/:id', (req, res) => adminUserController.restoreUser(req, res));
router.put('/doctors/:id/documents/:docType/status', (req, res) => adminUserController.updateDocumentStatus(req, res));
router.put('/doctors/:id/approve', (req, res) => adminUserController.approveDoctor(req, res));
router.put('/doctors/:id/qualifications/:qualId/status', (req, res) => adminUserController.updateQualificationStatus(req, res));
router.put('/doctors/:id/reject', (req, res) => adminUserController.rejectDoctor(req, res));
router.put('/doctors/:id/suspend', (req, res) => adminUserController.suspendDoctor(req, res));
router.put('/doctors/:id/unsuspend', (req, res) => adminUserController.unsuspendDoctor(req, res));
router.delete('/:id', (req, res) => adminUserController.deleteUser(req, res));

export default router;
