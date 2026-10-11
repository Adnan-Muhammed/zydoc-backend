// zydoc-backend/tests/f03-backend-unlock-guard.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

// ── Production Code Imports ──────────────────────────────────────────────────
import { MongoAppointmentRepository } from '../src/infrastructure/repositories/MongoAppointmentRepository.js';
import Appointment from '../src/infrastructure/database/models/Appointment.js';
import { VerifyPayment } from '../src/application/usecases/payment/VerifyPayment.js';

// ──────────────────────────────────────────────────────────────────────────────
// Suite: F-03 Backend Defense-in-Depth for unlockSlot & Payment Verification
// ──────────────────────────────────────────────────────────────────────────────
describe('F-03: Backend unlockSlot Defense-in-Depth & Payment Preservation', () => {
    let repository;
    let origFindOneAndDelete;
    let origFindOne;
    let origFindById;

    const testUserId = new mongoose.Types.ObjectId().toString();
    const otherUserId = new mongoose.Types.ObjectId().toString();
    const doctorId = new mongoose.Types.ObjectId().toString();
    const appointmentId = new mongoose.Types.ObjectId().toString();

    beforeEach(() => {
        repository = new MongoAppointmentRepository();
        origFindOneAndDelete = Appointment.findOneAndDelete;
        origFindOne = Appointment.findOne;
        origFindById = Appointment.findById;
    });

    afterEach(() => {
        Appointment.findOneAndDelete = origFindOneAndDelete;
        Appointment.findOne = origFindOne;
        Appointment.findById = origFindById;
    });

    it('1. Does NOT delete an appointment associated with an active Razorpay order (preserved for payment verification)', async () => {
        let capturedQuery = null;

        // Mock findOneAndDelete to intercept the query produced by production repository
        Appointment.findOneAndDelete = async (query) => {
            capturedQuery = query;
            // Simulate that an appointment with a razorpayOrderId does NOT match the query
            // because query restricts razorpayOrderId to [null, undefined, '']
            if (query.razorpayOrderId && Array.isArray(query.razorpayOrderId.$in)) {
                const allowed = query.razorpayOrderId.$in;
                const activeOrderId = 'order_active_123456';
                if (!allowed.includes(activeOrderId)) {
                    return null; // Not found by query, so NOT deleted
                }
            }
            return { _id: appointmentId, razorpayOrderId: 'order_active_123456' };
        };

        const result = await repository.unlockSlot(appointmentId, testUserId);

        assert.equal(result, null, 'Must return null and NOT delete appointment with active razorpayOrderId');
        assert.ok(capturedQuery, 'Query must be executed');
        assert.deepEqual(
            capturedQuery.razorpayOrderId,
            { $in: [null, undefined, ''] },
            'Query must explicitly restrict deletion to appointments without an active razorpayOrderId'
        );
    });

    it('2. Does NOT delete an appointment with a captured payment or paid paymentStatus', async () => {
        let capturedQuery = null;

        Appointment.findOneAndDelete = async (query) => {
            capturedQuery = query;
            return null;
        };

        const result = await repository.unlockSlot(appointmentId, testUserId);

        assert.equal(result, null, 'Must return null for paid/captured appointments');
        assert.deepEqual(
            capturedQuery.paymentStatus,
            { $ne: 'paid' },
            'Query must exclude appointments where paymentStatus is paid'
        );
        assert.deepEqual(
            capturedQuery.paymentId,
            { $in: [null, undefined, ''] },
            'Query must exclude appointments where paymentId exists'
        );
    });

    it('3. Safely deletes an uncommitted locked appointment before any payment attempt/order', async () => {
        let queryExecuted = null;
        const mockDeletedApp = {
            _id: appointmentId,
            status: 'locked',
            lockedBy: testUserId,
            paymentStatus: 'pending',
            razorpayOrderId: undefined,
            paymentId: undefined
        };

        Appointment.findOneAndDelete = async (query) => {
            queryExecuted = query;
            // Uncommitted lock has no orderId and no paymentId
            return mockDeletedApp;
        };

        const result = await repository.unlockSlot(appointmentId, testUserId);

        assert.deepEqual(result, mockDeletedApp, 'Should return the deleted appointment for legitimate pre-payment unlock');
        assert.equal(queryExecuted.status, 'locked', 'Query must only match locked appointments');
        assert.equal(queryExecuted.lockedBy, testUserId, 'Query must match lockedBy user');
    });

    it('4. Handles unlock by { doctorId, date, time } payload with identical safety constraints', async () => {
        let queryExecuted = null;

        Appointment.findOneAndDelete = async (query) => {
            queryExecuted = query;
            return { _id: appointmentId, status: 'locked' };
        };

        await repository.unlockSlot(
            { doctorId, date: '2026-10-15', time: '10:00 AM' },
            testUserId
        );

        assert.ok(queryExecuted, 'Query must be executed');
        assert.equal(queryExecuted.doctorId, doctorId);
        assert.equal(queryExecuted.appointmentTime, '10:00 AM');
        assert.deepEqual(queryExecuted.razorpayOrderId, { $in: [null, undefined, ''] });
        assert.deepEqual(queryExecuted.paymentId, { $in: [null, undefined, ''] });
        assert.deepEqual(queryExecuted.paymentStatus, { $ne: 'paid' });
    });

    it('5. Integration verification: appointment with razorpayOrderId survives unlock attempt and allows VerifyPayment to succeed', async () => {
        const orderId = 'order_survivor_98765';
        const paymentId = 'pay_survivor_12345';
        const signature = 'valid_mock_signature';

        const existingAppointment = {
            _id: appointmentId,
            status: 'locked',
            lockedBy: testUserId,
            fee: 500,
            consultationType: 'online',
            razorpayOrderId: orderId,
            paymentStatus: 'pending',
            save: async function () { return this; }
        };

        // Simulated in-memory DB:
        let dbAppointment = { ...existingAppointment };

        // Mock findOneAndDelete honoring production query guards
        Appointment.findOneAndDelete = async (query) => {
            if (dbAppointment.razorpayOrderId && query.razorpayOrderId?.$in) {
                if (!query.razorpayOrderId.$in.includes(dbAppointment.razorpayOrderId)) {
                    // Protected by razorpayOrderId guard: DO NOT DELETE
                    return null;
                }
            }
            const deleted = dbAppointment;
            dbAppointment = null;
            return deleted;
        };

        // 1. Attempt to unlock the slot while payment is in progress
        const unlockResult = await repository.unlockSlot(appointmentId, testUserId);
        assert.equal(unlockResult, null, 'unlockSlot must not delete the appointment');
        assert.ok(dbAppointment, 'Appointment must still exist in database');

        // 2. Mock repository.findByOrderId as used in VerifyPayment
        repository.findByOrderId = async (lookupOrderId) => {
            if (dbAppointment && dbAppointment.razorpayOrderId === lookupOrderId) {
                return dbAppointment;
            }
            return null;
        };

        repository.confirmBooking = async (id, userId, updateData) => {
            if (dbAppointment && dbAppointment._id === id && dbAppointment.status === 'locked') {
                dbAppointment = { ...dbAppointment, ...updateData, status: 'scheduled' };
                return dbAppointment;
            }
            return null;
        };

        // 3. VerifyPayment runs successfully because appointment was preserved!
        const mockPaymentService = {
            verifySignature: () => true,
            refundPayment: async () => {}
        };

        const verifyPaymentUseCase = new VerifyPayment(
            mockPaymentService,
            repository,
            null, // transactionRepository
            null, // mailService
            null  // socketService
        );

        const verificationResult = await verifyPaymentUseCase.execute(orderId, paymentId, signature);

        assert.ok(verificationResult.success, 'VerifyPayment must succeed');
        assert.equal(dbAppointment.status, 'scheduled', 'Appointment status must be updated to scheduled');
        assert.equal(dbAppointment.paymentStatus, 'paid', 'Payment status must be paid');
        assert.equal(dbAppointment.paymentId, paymentId, 'Payment ID must be saved');
    });
});
