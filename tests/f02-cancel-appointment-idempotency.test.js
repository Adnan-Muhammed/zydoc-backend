// zydoc-backend/tests/f02-cancel-appointment-idempotency.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

// ── Production Code Imports ──────────────────────────────────────────────────
import { CancelAppointmentUseCase } from '../src/application/usecases/appointment/CancelAppointmentUseCase.js';
import Appointment from '../src/infrastructure/database/models/Appointment.js';
import WalletTransaction from '../src/infrastructure/database/models/WalletTransaction.js';
import Transaction from '../src/infrastructure/database/models/Transaction.js';

// ──────────────────────────────────────────────────────────────────────────────
// Suite: F-02 Duplicate Wallet Refund Prevention & Idempotency
// ──────────────────────────────────────────────────────────────────────────────
describe('F-02: CancelAppointmentUseCase Concurrency & Idempotent Refunds (Production Code)', () => {
    let origFindById;
    let origFindOneAndUpdate;
    let origWalletFindOne;
    let origTxFindOneAndUpdate;

    const patientId = new mongoose.Types.ObjectId().toString();
    const otherPatientId = new mongoose.Types.ObjectId().toString();
    const doctorId = new mongoose.Types.ObjectId().toString();
    const appointmentId = new mongoose.Types.ObjectId().toString();

    // Future date strictly > 24 hours (e.g. 5 days in future)
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const scheduledStartUTC = new Date(futureDate.getTime());

    beforeEach(() => {
        origFindById = Appointment.findById;
        origFindOneAndUpdate = Appointment.findOneAndUpdate;
        origWalletFindOne = WalletTransaction.findOne;
        origTxFindOneAndUpdate = Transaction.findOneAndUpdate;

        // Default mock for doctor Transaction update
        Transaction.findOneAndUpdate = async () => ({ status: 'refunded' });
    });

    afterEach(() => {
        Appointment.findById = origFindById;
        Appointment.findOneAndUpdate = origFindOneAndUpdate;
        WalletTransaction.findOne = origWalletFindOne;
        Transaction.findOneAndUpdate = origTxFindOneAndUpdate;
    });

    function createMockAppointment(overrides = {}) {
        return {
            _id: appointmentId,
            patientId,
            doctorId,
            status: 'scheduled',
            paymentStatus: 'paid',
            fee: 600,
            feeBreakdown: { totalFee: 600 },
            appointmentDate: futureDate,
            appointmentTime: '11:00 AM',
            scheduledStartAt: scheduledStartUTC,
            doctorTimezone: 'Asia/Kolkata',
            save: async function () { return this; },
            ...overrides,
        };
    }

    it('1. Two concurrent cancellation requests for the same appointment produce at most one refund', async () => {
        let appDoc = createMockAppointment();
        let creditCallCount = 0;
        let creditAmounts = [];

        // Mock CreditWalletUseCase with slight artificial delay to simulate network/DB I/O
        const mockCreditWalletUseCase = {
            execute: async ({ amount }) => {
                creditCallCount++;
                creditAmounts.push(amount);
                await new Promise(r => setTimeout(r, 40));
                return { balance: 1200, transaction: { _id: 'tx_wallet_123' } };
            }
        };

        // Simulated atomic DB state in MongoDB
        Appointment.findById = async () => appDoc;
        Appointment.findOneAndUpdate = async (query, update) => {
            // Atomic check: only matches if status is 'scheduled'
            if (query.status === 'scheduled') {
                if (appDoc.status === 'scheduled') {
                    appDoc.status = update.$set.status; // 'refund_pending'
                    appDoc.refundClaimedAt = update.$set.refundClaimedAt;
                    return appDoc;
                }
                return null;
            }
            if (query.status === 'refund_pending') {
                // Lease is currently active for the in-flight request, so concurrent caller receives null
                return null;
            }
            return null;
        };

        WalletTransaction.findOne = async () => null;

        const useCase = new CancelAppointmentUseCase(mockCreditWalletUseCase);

        // Execute two concurrent cancellation requests simultaneously
        const [res1, res2] = await Promise.all([
            useCase.execute({ appointmentId, patientId }),
            useCase.execute({ appointmentId, patientId }),
        ]);

        // Assertions
        assert.equal(creditCallCount, 1, 'CreditWalletUseCase must be called EXACTLY ONCE across concurrent requests');
        assert.deepEqual(creditAmounts, [600], 'Must credit exactly the single appointment fee of 600');
        assert.ok(res1.success, 'Request 1 must succeed');
        assert.ok(res2.success, 'Request 2 must succeed');
        assert.equal(appDoc.status, 'cancelled', 'Final appointment status must be cancelled');
        assert.equal(appDoc.paymentStatus, 'refunded', 'Payment status must be refunded');
    });

    it('2. A retry after a successful refund does not credit the wallet again', async () => {
        let appDoc = createMockAppointment();
        let creditCallCount = 0;

        const mockCreditWalletUseCase = {
            execute: async () => {
                creditCallCount++;
                return { balance: 600, transaction: { _id: 'tx_wallet_123' } };
            }
        };

        Appointment.findById = async () => appDoc;
        Appointment.findOneAndUpdate = async (query, update) => {
            if (query.status === 'scheduled' && appDoc.status === 'scheduled') {
                appDoc.status = update.$set.status;
                return appDoc;
            }
            return null;
        };
        WalletTransaction.findOne = async () => null;

        const useCase = new CancelAppointmentUseCase(mockCreditWalletUseCase);

        // First attempt: succeeds and completes refund
        const firstResult = await useCase.execute({ appointmentId, patientId });
        assert.ok(firstResult.success);
        assert.equal(creditCallCount, 1, 'Credit must be executed on first call');
        assert.equal(appDoc.status, 'cancelled');
        assert.equal(appDoc.paymentStatus, 'refunded');

        // Second attempt (retry on already-cancelled appointment)
        await assert.rejects(
            async () => {
                await useCase.execute({ appointmentId, patientId });
            },
            (err) => {
                assert.equal(err.statusCode, 400);
                assert.match(err.message, /Cannot cancel appointment with status 'cancelled'/);
                return true;
            },
            'Must reject retry with 400 error'
        );

        assert.equal(creditCallCount, 1, 'Credit count must remain 1 — no second refund on retry');
    });

    it('3. A wallet-credit failure leaves a recoverable state and a retry does not lose or duplicate the refund', async () => {
        let appDoc = createMockAppointment();
        let creditCallCount = 0;
        let failCredit = true;

        const mockCreditWalletUseCase = {
            execute: async () => {
                creditCallCount++;
                if (failCredit) {
                    throw new Error('Database connection failed during wallet credit');
                }
                return { balance: 600, transaction: { _id: 'tx_wallet_recovered_456' } };
            }
        };

        Appointment.findById = async () => appDoc;
        Appointment.findOneAndUpdate = async (query, update) => {
            if (query.status === 'scheduled' && appDoc.status === 'scheduled') {
                appDoc.status = update.$set.status; // transitions to 'refund_pending'
                return appDoc;
            }
            if (query.status === 'refund_pending' && appDoc.status === 'refund_pending') {
                appDoc.refundClaimedAt = update.$set.refundClaimedAt;
                return appDoc;
            }
            return null;
        };
        WalletTransaction.findOne = async () => null; // No wallet transaction recorded yet

        const useCase = new CancelAppointmentUseCase(mockCreditWalletUseCase);

        // Attempt 1: Wallet credit fails
        await assert.rejects(
            async () => {
                await useCase.execute({ appointmentId, patientId });
            },
            (err) => {
                assert.match(err.message, /Database connection failed/);
                return true;
            }
        );

        assert.equal(creditCallCount, 1, 'First attempt attempted credit');
        assert.equal(appDoc.status, 'refund_pending', 'Appointment must be left in recoverable refund_pending state, NOT prematurely cancelled');
        assert.notEqual(appDoc.paymentStatus, 'refunded', 'Payment status must NOT be refunded yet');

        // Attempt 2 (Retry): Service is now healthy
        failCredit = false;
        const retryResult = await useCase.execute({ appointmentId, patientId });

        assert.ok(retryResult.success, 'Retry must succeed');
        assert.equal(creditCallCount, 2, 'Retry should execute credit now that it is healthy');
        assert.equal(appDoc.status, 'cancelled', 'Appointment is now safely cancelled');
        assert.equal(appDoc.paymentStatus, 'refunded', 'Payment status is marked refunded');

        // Attempt 3: Simulation where credit succeeded on prior run, but appointment save failed
        // Reset to refund_pending, but mock that WalletTransaction DOES exist
        appDoc.status = 'refund_pending';
        let creditCalledInAttempt3 = false;
        mockCreditWalletUseCase.execute = async () => {
            creditCalledInAttempt3 = true;
            throw new Error('Should not be called!');
        };
        WalletTransaction.findOne = async () => ({
            _id: 'tx_already_recorded',
            createdAt: new Date(),
        });

        const attempt3Result = await useCase.execute({ appointmentId, patientId });
        assert.ok(attempt3Result.success, 'Attempt 3 must complete cancellation');
        assert.equal(creditCalledInAttempt3, false, 'Must NOT call creditWalletUseCase again when WalletTransaction already exists');
        assert.equal(appDoc.status, 'cancelled');
    });

    it('4. A patient cannot cancel another patient\'s appointment', async () => {
        let appDoc = createMockAppointment({ patientId });
        let creditCalled = false;

        const mockCreditWalletUseCase = {
            execute: async () => {
                creditCalled = true;
            }
        };

        Appointment.findById = async () => appDoc;
        const useCase = new CancelAppointmentUseCase(mockCreditWalletUseCase);

        await assert.rejects(
            async () => {
                await useCase.execute({ appointmentId, patientId: otherPatientId });
            },
            (err) => {
                assert.equal(err.statusCode, 403, 'Must return 403 Forbidden');
                assert.match(err.message, /You are not authorized to cancel this appointment/);
                return true;
            }
        );

        assert.equal(creditCalled, false, 'Unauthorized user must never trigger wallet credit');
    });

    it('5. Ineligible appointment statuses follow existing behavior', async () => {
        const mockCreditWalletUseCase = { execute: async () => {} };
        const useCase = new CancelAppointmentUseCase(mockCreditWalletUseCase);

        // Case A: Completed appointment
        let completedApp = createMockAppointment({ status: 'completed' });
        Appointment.findById = async () => completedApp;

        await assert.rejects(
            async () => {
                await useCase.execute({ appointmentId, patientId });
            },
            (err) => {
                assert.equal(err.statusCode, 400);
                assert.match(err.message, /Cannot cancel appointment with status 'completed'/);
                return true;
            }
        );

        // Case B: Scheduled appointment within 24 hours
        const soonDate = new Date(Date.now() + 10 * 60 * 60 * 1000); // 10 hours from now
        let nearTermApp = createMockAppointment({
            status: 'scheduled',
            appointmentDate: soonDate,
            scheduledStartAt: soonDate,
        });
        Appointment.findById = async () => nearTermApp;

        await assert.rejects(
            async () => {
                await useCase.execute({ appointmentId, patientId });
            },
            (err) => {
                assert.equal(err.statusCode, 400);
                assert.equal(err.code, 'CANCELLATION_WINDOW_CLOSED');
                assert.match(err.message, /strictly more than 24 hours prior/);
                return true;
            }
        );
    });

    it('6. Existing wallet transaction records and refund calculations remain compatible', async () => {
        let capturedCreditPayload = null;
        let appDoc = createMockAppointment({
            fee: 750,
            feeBreakdown: { totalFee: 750, walletDeducted: 250, onlinePaid: 500 }
        });

        const mockCreditWalletUseCase = {
            execute: async (payload) => {
                capturedCreditPayload = payload;
                return { balance: 750, transaction: { _id: 'tx_comp_789' } };
            }
        };

        Appointment.findById = async () => appDoc;
        Appointment.findOneAndUpdate = async (query, update) => {
            if (query.status === 'scheduled') {
                appDoc.status = update.$set.status;
                return appDoc;
            }
            return null;
        };
        WalletTransaction.findOne = async () => null;

        const useCase = new CancelAppointmentUseCase(mockCreditWalletUseCase);
        const result = await useCase.execute({ appointmentId, patientId });

        assert.ok(result.success);
        assert.ok(capturedCreditPayload, 'Credit payload must be sent');
        assert.equal(capturedCreditPayload.amount, 750, 'Must refund 100% of the totalFee (₹750)');
        assert.equal(capturedCreditPayload.source, 'PATIENT_CANCELLATION', 'Source must match existing PATIENT_CANCELLATION convention');
        assert.equal(capturedCreditPayload.appointmentId, appointmentId, 'Must link to appointmentId');
        assert.equal(appDoc.refundAmount, 750, 'refundAmount must be saved on appointment document');
        assert.ok(appDoc.refundedAt, 'refundedAt timestamp must be recorded');
    });
});
