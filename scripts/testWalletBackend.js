import 'dotenv/config';
import assert from 'assert';
import mongoose from 'mongoose';

console.log('--- STEP 1: Verifying Database Models ---');
import Patient from '../src/infrastructure/database/models/PatientProfile.js';
import WalletTransaction from '../src/infrastructure/database/models/WalletTransaction.js';
import Appointment from '../src/infrastructure/database/models/Appointment.js';

// Verify Patient schema has walletBalance
const patientWalletPath = Patient.schema.path('walletBalance');
assert(patientWalletPath, 'Patient schema must have walletBalance field');
assert.strictEqual(patientWalletPath.instance, 'Number', 'walletBalance must be a Number');
assert.strictEqual(patientWalletPath.defaultValue, 0, 'walletBalance default must be 0');
console.log('✔ PatientProfile.walletBalance verified');

// Verify WalletTransaction schema fields
assert(WalletTransaction.schema.path('patientId'), 'WalletTransaction must have patientId');
assert(WalletTransaction.schema.path('amount'), 'WalletTransaction must have amount');
assert(WalletTransaction.schema.path('type'), 'WalletTransaction must have type');
assert(WalletTransaction.schema.path('source'), 'WalletTransaction must have source');
assert(WalletTransaction.schema.path('description'), 'WalletTransaction must have description');
assert(WalletTransaction.schema.path('appointmentId'), 'WalletTransaction must have appointmentId');
assert(WalletTransaction.schema.path('createdAt'), 'WalletTransaction must have createdAt');
console.log('✔ WalletTransaction schema verified');

// Verify Appointment schema additions
const statusEnum = Appointment.schema.path('status').enumValues;
assert(statusEnum.includes('doctor_missed'), 'Appointment status enum must include doctor_missed');
assert(statusEnum.includes('in_progress'), 'Appointment status enum must include in_progress');
assert(statusEnum.includes('cancelled'), 'Appointment status enum must include cancelled');
assert(statusEnum.includes('refunded'), 'Appointment status enum must include refunded');

const paymentMethodPath = Appointment.schema.path('paymentMethod');
assert(paymentMethodPath, 'Appointment must have paymentMethod field');
assert(paymentMethodPath.enumValues.includes('FULL_ONLINE'), 'paymentMethod must include FULL_ONLINE');
assert(paymentMethodPath.enumValues.includes('FULL_WALLET'), 'paymentMethod must include FULL_WALLET');
assert(paymentMethodPath.enumValues.includes('SPLIT'), 'paymentMethod must include SPLIT');

assert(Appointment.schema.path('feeBreakdown.totalFee'), 'Appointment must have feeBreakdown.totalFee');
assert(Appointment.schema.path('feeBreakdown.walletDeducted'), 'Appointment must have feeBreakdown.walletDeducted');
assert(Appointment.schema.path('feeBreakdown.onlinePaid'), 'Appointment must have feeBreakdown.onlinePaid');
console.log('✔ Appointment schema additions verified');

console.log('\n--- STEP 2: Verifying Domain & Repositories ---');
import { WalletRepository } from '../src/domain/repositories/WalletRepository.js';
import { MongoWalletRepository } from '../src/infrastructure/repositories/MongoWalletRepository.js';
import { AppointmentRepository } from '../src/domain/repositories/AppointmentRepository.js';
import { MongoAppointmentRepository } from '../src/infrastructure/repositories/MongoAppointmentRepository.js';

const walletRepo = new MongoWalletRepository();
assert(walletRepo instanceof WalletRepository, 'MongoWalletRepository must inherit WalletRepository');
assert(typeof walletRepo.getBalance === 'function', 'getBalance must be a function');
assert(typeof walletRepo.creditWallet === 'function', 'creditWallet must be a function');
assert(typeof walletRepo.debitWallet === 'function', 'debitWallet must be a function');
assert(typeof walletRepo.getTransactionHistory === 'function', 'getTransactionHistory must be a function');
console.log('✔ MongoWalletRepository interface & methods verified');

const appointmentRepo = new MongoAppointmentRepository();
assert(appointmentRepo instanceof AppointmentRepository, 'MongoAppointmentRepository must inherit AppointmentRepository');
assert(typeof appointmentRepo.lazyUpdateNoShows === 'function', 'lazyUpdateNoShows must be a function');
console.log('✔ MongoAppointmentRepository verified');

console.log('\n--- STEP 3: Verifying Use Cases Logic ---');
import { CreditWalletUseCase } from '../src/application/usecases/wallet/CreditWalletUseCase.js';
import { DebitWalletUseCase } from '../src/application/usecases/wallet/DebitWalletUseCase.js';
import { GetPatientWalletUseCase } from '../src/application/usecases/wallet/GetPatientWalletUseCase.js';
import { CreatePaymentOrder } from '../src/application/usecases/payment/CreatePaymentOrder.js';
import { VerifyPayment } from '../src/application/usecases/payment/VerifyPayment.js';
import { CancelAppointmentUseCase } from '../src/application/usecases/appointment/CancelAppointmentUseCase.js';
import { ApproveOfflineDisputeUseCase } from '../src/application/usecases/admin/ApproveOfflineDisputeUseCase.js';

// Mock Wallet Repository for testing Use Cases in isolation
class MockWalletRepository extends WalletRepository {
  constructor(initialBalance = 1000) {
    super();
    this.balance = initialBalance;
    this.transactions = [];
  }
  async getBalance(patientId) {
    return this.balance;
  }
  async creditWallet(patientId, amount, source, description, appointmentId = null) {
    this.balance += amount;
    const tx = { patientId, amount, type: 'CREDIT', source, description, appointmentId };
    this.transactions.push(tx);
    return { balance: this.balance, transaction: tx };
  }
  async debitWallet(patientId, amount, description, appointmentId = null) {
    if (this.balance < amount) throw new Error('Insufficient wallet balance');
    this.balance -= amount;
    const tx = { patientId, amount, type: 'DEBIT', source: 'BOOKING_PAYMENT', description, appointmentId };
    this.transactions.push(tx);
    return { balance: this.balance, transaction: tx };
  }
  async getTransactionHistory(patientId, { page = 1, limit = 10 } = {}) {
    return { transactions: this.transactions, total: this.transactions.length, page, limit, totalPages: 1 };
  }
}

// 3A. Test Credit & Debit Use Cases
const mockWallet = new MockWalletRepository(500);
const creditUseCase = new CreditWalletUseCase(mockWallet);
const debitUseCase = new DebitWalletUseCase(mockWallet);
const getWalletUseCase = new GetPatientWalletUseCase(mockWallet);

const creditRes = await creditUseCase.execute({
  patientId: 'user123',
  amount: 200,
  source: 'DOCTOR_MISSED',
  description: 'Refund for missed consult'
});
assert.strictEqual(creditRes.balance, 700, 'Balance after credit should be 700');

const debitRes = await debitUseCase.execute({
  patientId: 'user123',
  amount: 300,
  description: 'Booking payment'
});
assert.strictEqual(debitRes.balance, 400, 'Balance after debit should be 400');

// Test insufficient funds
let debitFailed = false;
try {
  await debitUseCase.execute({ patientId: 'user123', amount: 1000, description: 'Over-limit' });
} catch (err) {
  debitFailed = true;
  assert.strictEqual(err.code, 'INSUFFICIENT_WALLET_BALANCE');
}
assert(debitFailed, 'Debit beyond balance must throw INSUFFICIENT_WALLET_BALANCE');

const walletDetails = await getWalletUseCase.execute('user123');
assert.strictEqual(walletDetails.balance, 400);
assert.strictEqual(walletDetails.transactions.length, 2);
console.log('✔ CreditWalletUseCase, DebitWalletUseCase & GetPatientWalletUseCase verified');

// 3B. Test CreatePaymentOrder (Full Wallet, Split, Full Online)
const mockPaymentService = {
  createOrder: async (amountInPaise, receipt) => ({
    id: 'order_rzp_123',
    amount: amountInPaise,
    currency: 'INR'
  })
};

// Test Scenario 1: FULL_WALLET
const appointmentFullWallet = {
  _id: 'app_1',
  fee: 300,
  status: 'available',
  consultationType: 'online',
  appointmentDate: new Date(),
  appointmentTime: '10:00 AM',
  save: async function() { return this; }
};
const mockAppRepoFull = {
  findById: async () => appointmentFullWallet
};
const fullWalletMock = new MockWalletRepository(500);
const createOrderFullWallet = new CreatePaymentOrder(
  mockPaymentService,
  mockAppRepoFull,
  fullWalletMock,
  new DebitWalletUseCase(fullWalletMock)
);

const fullWalletOrder = await createOrderFullWallet.execute('app_1', 'user_abc', true);
assert.strictEqual(fullWalletOrder.status, 'COMPLETED_VIA_WALLET');
assert.strictEqual(appointmentFullWallet.paymentMethod, 'FULL_WALLET');
assert.strictEqual(appointmentFullWallet.status, 'scheduled');
assert.strictEqual(appointmentFullWallet.feeBreakdown.walletDeducted, 300);
assert.strictEqual(appointmentFullWallet.feeBreakdown.onlinePaid, 0);
assert.strictEqual(fullWalletMock.balance, 200, 'Wallet balance should be 500 - 300 = 200');
console.log('✔ CreatePaymentOrder FULL_WALLET verified');

// Test Scenario 2: SPLIT PAYMENT (Wallet balance < slotFee)
const appointmentSplit = {
  _id: 'app_2',
  fee: 500,
  status: 'available',
  consultationType: 'online',
  appointmentDate: new Date(),
  appointmentTime: '11:00 AM',
  save: async function() { return this; }
};
const mockAppRepoSplit = {
  findById: async () => appointmentSplit
};
const splitWalletMock = new MockWalletRepository(200); // 200 available, fee is 500
const createOrderSplit = new CreatePaymentOrder(
  mockPaymentService,
  mockAppRepoSplit,
  splitWalletMock,
  new DebitWalletUseCase(splitWalletMock)
);

const splitOrderRes = await createOrderSplit.execute('app_2', 'user_abc', true);
assert.strictEqual(splitOrderRes.splitPayment, true);
assert.strictEqual(splitOrderRes.walletDeducted, 200);
assert.strictEqual(splitOrderRes.onlinePayable, 300);
assert.strictEqual(splitOrderRes.amount, 30000); // 300 * 100 paise
assert.strictEqual(appointmentSplit.paymentMethod, 'SPLIT');
assert.strictEqual(appointmentSplit.status, 'locked');
// Fail-safe check: Wallet balance should NOT be debited yet during order creation
assert.strictEqual(splitWalletMock.balance, 200, 'Wallet must NOT be debited during CreatePaymentOrder for split payment');
console.log('✔ CreatePaymentOrder SPLIT payment (fail-safe no premature debit) verified');

// Test Scenario 3: VerifyPayment SPLIT payment wallet deduction
const mockVerifyPaymentService = {
  verifySignature: () => true
};
const mockAppRepoVerify = {
  findByOrderId: async () => appointmentSplit,
  confirmBooking: async (id, userId, updateData) => ({
    ...appointmentSplit,
    ...updateData,
    status: 'scheduled'
  })
};
const verifyPaymentUseCase = new VerifyPayment(
  mockVerifyPaymentService,
  mockAppRepoVerify,
  null,
  null,
  null,
  new DebitWalletUseCase(splitWalletMock)
);

const verifyRes = await verifyPaymentUseCase.execute('order_rzp_123', 'pay_123', 'sig_123');
assert(verifyRes.success);
assert.strictEqual(splitWalletMock.balance, 0, 'Wallet balance must now be debited after successful VerifyPayment');
console.log('✔ VerifyPayment SPLIT payment post-verification wallet deduction verified');

console.log('\n--- STEP 4: Verifying Cancellation Window (Strict 24 Hours) ---');
// Test cancellation window
const now = new Date();
const appointmentIn10Hours = {
  _id: 'app_soon',
  patientId: 'patient_1',
  fee: 500,
  status: 'scheduled',
  scheduledStartAt: new Date(now.getTime() + 10 * 3600 * 1000), // in 10 hours (< 24h)
  save: async function() { return this; }
};
const cancelUseCase = new CancelAppointmentUseCase(new CreditWalletUseCase(new MockWalletRepository()));

// Test < 24 hours rejection
let cancelRejected = false;
try {
  // Mock Appointment.findById
  const origFindById = Appointment.findById;
  Appointment.findById = async () => appointmentIn10Hours;
  await cancelUseCase.execute({ appointmentId: 'app_soon', patientId: 'patient_1' });
  Appointment.findById = origFindById;
} catch (err) {
  cancelRejected = true;
  assert.strictEqual(err.code, 'CANCELLATION_WINDOW_CLOSED');
  assert(err.message.includes('24 hours'));
}
assert(cancelRejected, 'Cancelling within 24 hours must throw CANCELLATION_WINDOW_CLOSED');
console.log('✔ Strict 24-Hour cancellation window enforcement verified');

console.log('\n--- STEP 5: Verifying Server & Presentation Layer Routes ---');
import { walletController, getWalletDetails } from '../src/presentation/controllers/WalletController.js';
import walletRoutes from '../src/presentation/routes/walletRoutes.js';
import paymentRoutes from '../src/presentation/routes/paymentRoutes.js';

assert(walletController && typeof getWalletDetails === 'function', 'WalletController must be exported');
assert(walletRoutes, 'walletRoutes must be exported');
assert(paymentRoutes, 'paymentRoutes must be exported');
console.log('✔ Controllers & Routes verified');

console.log('\n========================================');
console.log('ALL BACKEND WALLET & REFUND CHECKS PASSED!');
console.log('========================================');
process.exit(0);
