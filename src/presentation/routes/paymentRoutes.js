const express = require('express');
const router = express.Router();

// Assuming authMiddleware exists. Adjust the path based on your project structure.
const authMiddleware = require('../middlewares/authMiddleware');

// Import Controller
const PaymentController = require('./PaymentController');

// Import Use Cases
const CreatePaymentOrder = require('../../application/usecases/payment/CreatePaymentOrder');
const VerifyPayment = require('../../application/usecases/payment/VerifyPayment');

// Import Service and Repositories (Paths might need slight adjustment based on actual DB structure)
const PaymentService = require('../../infrastructure/services/PaymentService');
const AppointmentRepository = require('../../infrastructure/repositories/AppointmentRepository'); 
const TransactionRepository = require('../../infrastructure/repositories/TransactionRepository'); 

// 1. Instantiate Repositories
const appointmentRepository = new AppointmentRepository();
const transactionRepository = new TransactionRepository();

// 2. Instantiate Use Cases with Dependencies injected
const createPaymentOrder = new CreatePaymentOrder(PaymentService, appointmentRepository);
const verifyPayment = new VerifyPayment(PaymentService, appointmentRepository, transactionRepository);

// 3. Instantiate Controller with Use Cases injected
const paymentController = new PaymentController(createPaymentOrder, verifyPayment);

// Routes mapped to controller methods, protected by authMiddleware
router.post('/create-order', authMiddleware, paymentController.createOrder);
router.post('/verify', authMiddleware, paymentController.verifyPayment);

module.exports = router;
