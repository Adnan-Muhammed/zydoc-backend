// zydoc-backend/tests/p0-authorization.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

// ── Production Code Imports ──────────────────────────────────────────────────
import { SocketService } from '../src/infrastructure/services/SocketService.js';
import { JoinRoomUseCase } from '../src/modules/video-call/use-cases/JoinRoomUseCase.js';
import { EndRoomUseCase } from '../src/modules/video-call/use-cases/EndRoomUseCase.js';
import Appointment from '../src/infrastructure/database/models/Appointment.js';
import SharedUser from '../src/infrastructure/database/models/SharedUser.js';
import ConsultationRecord from '../src/infrastructure/database/models/ConsultationRecord.js';
import Doctor from '../src/infrastructure/database/models/DoctorProfile.js';
import DoctorSlotOverride from '../src/infrastructure/database/models/DoctorSlotOverride.js';
import Transaction from '../src/infrastructure/database/models/Transaction.js';
import { MongoTransactionRepository } from '../src/infrastructure/repositories/MongoTransactionRepository.js';
import {
    getAppointmentById,
    getClinicalContext,
    saveClinicalNotes,
    savePrescriptions,
    uploadConsultationFile,
    completeOfflineAppointment,
    updateAppointmentStatus,
    getAvailableSlots
} from '../src/presentation/controllers/AppointmentController.js';

const TEST_SECRET = 'p0_test_jwt_secret_key_12345';
process.env.JWT_SECRET = TEST_SECRET;

// ── Test Helpers ─────────────────────────────────────────────────────────────

function createMockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        }
    };
}

function chainableQuery(result) {
    const query = {
        select() { return query; },
        populate() { return query; },
        sort() { return query; },
        limit() { return query; },
        lean() { return query; },
        then(resolve, reject) {
            return Promise.resolve(result).then(resolve, reject);
        },
        catch(reject) {
            return Promise.resolve(result).catch(reject);
        }
    };
    return query;
}

// ──────────────────────────────────────────────────────────────────────────────
// Suite 1: INT-001 Socket.IO Handshake Authentication & RBAC (Real SocketService)
// ──────────────────────────────────────────────────────────────────────────────
describe('P0 INT-001: SocketService Handshake Authentication & RBAC (Production Code)', () => {
    let service;

    beforeEach(() => {
        service = new SocketService();
    });

    it('should reject handshake when token is missing from auth, header, and cookie', () => {
        const socket = {
            handshake: { auth: {}, headers: {} }
        };
        let receivedError = null;

        // Directly invokes production SocketService.authenticateSocket
        service.authenticateSocket(socket, (err) => { receivedError = err; });

        assert.ok(receivedError, 'Must pass an error to next()');
        assert.match(receivedError.message, /Unauthorized: No token provided/);
    });

    it('should reject handshake when token is malformed or invalid', () => {
        const socket = {
            handshake: { auth: { token: 'invalid.garbage.token' }, headers: {} }
        };
        let receivedError = null;

        service.authenticateSocket(socket, (err) => { receivedError = err; });

        assert.ok(receivedError, 'Must reject malformed token');
        assert.match(receivedError.message, /Unauthorized/);
    });

    it('should reject handshake when token is expired', () => {
        const expiredToken = jwt.sign(
            { id: 'user_exp', role: 'patient' },
            TEST_SECRET,
            { expiresIn: -10 } // Expired in the past
        );
        const socket = {
            handshake: { auth: { token: expiredToken }, headers: {} }
        };
        let receivedError = null;

        service.authenticateSocket(socket, (err) => { receivedError = err; });

        assert.ok(receivedError, 'Must reject expired token');
        assert.match(receivedError.message, /jwt expired/);
    });

    it('should accept valid token from socket.handshake.auth.token and bind verified identity', () => {
        const validToken = jwt.sign(
            { id: 'doc_user_42', role: 'doctor', name: 'Dr. John' },
            TEST_SECRET,
            { expiresIn: '15m' }
        );
        const socket = {
            handshake: { auth: { token: validToken }, headers: {} }
        };
        let receivedError = null;

        service.authenticateSocket(socket, (err) => { receivedError = err; });

        assert.equal(receivedError, undefined, 'Must accept valid token');
        assert.equal(socket.userId, 'doc_user_42');
        assert.equal(socket.userRole, 'doctor');
    });

    it('should accept valid token from Authorization: Bearer header', () => {
        const validToken = jwt.sign(
            { id: 'pat_user_99', role: 'patient' },
            TEST_SECRET,
            { expiresIn: '15m' }
        );
        const socket = {
            handshake: {
                auth: {},
                headers: { authorization: `Bearer ${validToken}` }
            }
        };
        let receivedError = null;

        service.authenticateSocket(socket, (err) => { receivedError = err; });

        assert.equal(receivedError, undefined);
        assert.equal(socket.userId, 'pat_user_99');
        assert.equal(socket.userRole, 'patient');
    });

    it('should accept valid token from cookie accessToken header (httpOnly transport)', () => {
        const validToken = jwt.sign(
            { id: 'adm_user_1', role: 'admin' },
            TEST_SECRET,
            { expiresIn: '15m' }
        );
        const socket = {
            handshake: {
                auth: {},
                headers: { cookie: `theme=dark; accessToken=${validToken}; other=123` }
            }
        };
        let receivedError = null;

        service.authenticateSocket(socket, (err) => { receivedError = err; });

        assert.equal(receivedError, undefined);
        assert.equal(socket.userId, 'adm_user_1');
        assert.equal(socket.userRole, 'admin');
    });

    it('should join admin_room ONLY if verified JWT role is admin (prevents client escalation)', () => {
        const joinedRooms = new Set();
        const mockSocket = {
            id: 'sock_1',
            userId: 'doctor_10',
            userRole: 'doctor',
            join(room) { joinedRooms.add(room); },
            on(event, handler) { this[event] = handler; }
        };

        // Call production handleConnection
        service.handleConnection(mockSocket);

        // Verified user room joined, but NOT admin_room
        assert.ok(joinedRooms.has('doctor_10'), 'Should join private user room');
        assert.ok(!joinedRooms.has('admin_room'), 'Doctor must NOT join admin_room');

        // Client attempts to emit register event requesting admin role
        mockSocket.register({ role: 'admin' });

        // Still must not be in admin_room
        assert.ok(!joinedRooms.has('admin_room'), 'Client-controlled register event must NOT grant admin_room');
    });

    it('should allow legitimate admin user to join admin_room upon connection', () => {
        const joinedRooms = new Set();
        const mockAdminSocket = {
            id: 'sock_admin_1',
            userId: 'admin_user_01',
            userRole: 'admin',
            join(room) { joinedRooms.add(room); },
            on(event, handler) {}
        };

        service.handleConnection(mockAdminSocket);

        assert.ok(joinedRooms.has('admin_user_01'));
        assert.ok(joinedRooms.has('admin_room'), 'Legitimate admin MUST join admin_room');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suite 2: INT-002 WebRTC Participant Authorization (Real JoinRoomUseCase & EndRoomUseCase)
// ──────────────────────────────────────────────────────────────────────────────
describe('P0 INT-002: WebRTC Room Participant Authorization (Production Use Cases)', () => {
    const patientUserId = new mongoose.Types.ObjectId().toString();
    const doctorProfileId = new mongoose.Types.ObjectId().toString();
    const doctorUserId = new mongoose.Types.ObjectId().toString();
    const attackerUserId = new mongoose.Types.ObjectId().toString();
    const appointmentId = new mongoose.Types.ObjectId().toString();

    let mockAppointmentRepo;
    let mockGateway;
    let emittedEvents;
    let origSharedUserFindById;
    let origSharedUserFindOne;

    beforeEach(() => {
        emittedEvents = [];
        mockGateway = {
            socket: { id: 'socket_conn_1' },
            emitToSocket(socketId, event, data) {
                emittedEvents.push({ target: 'socket', socketId, event, data });
            },
            emitToUser(userId, event, data) {
                emittedEvents.push({ target: 'user', userId, event, data });
            },
            emitToRoom(roomId, event, data) {
                emittedEvents.push({ target: 'room', roomId, event, data });
            },
            joinRoom(roomId) {},
            getRoomSize(roomId) { return 0; },
            getSocket(id) { return null; }
        };

        mockAppointmentRepo = {
            findById: async (id) => {
                if (id === appointmentId) {
                    return {
                        _id: appointmentId,
                        patientId: new mongoose.Types.ObjectId(patientUserId),
                        doctorId: new mongoose.Types.ObjectId(doctorProfileId),
                        status: 'scheduled',
                        consultationType: 'online',
                        save: async function() { return this; }
                    };
                }
                return null;
            }
        };

        origSharedUserFindOne = SharedUser.findOne;
        SharedUser.findOne = () => chainableQuery(null);

        // Mock SharedUser.findById for resolving doctor profileId
        origSharedUserFindById = SharedUser.findById;
        SharedUser.findById = (id) => {
            if (String(id) === String(doctorUserId)) {
                return chainableQuery({
                    _id: doctorUserId,
                    role: 'doctor',
                    profileId: new mongoose.Types.ObjectId(doctorProfileId)
                });
            }
            return chainableQuery(null);
        };
    });

    afterEach(() => {
        SharedUser.findById = origSharedUserFindById;
        SharedUser.findOne = origSharedUserFindOne;
    });

    it('should allow assigned patient into consultation room without error', async () => {
        const useCase = new JoinRoomUseCase(mockGateway, mockAppointmentRepo);

        // Executes actual production JoinRoomUseCase.execute
        await useCase.execute(appointmentId, patientUserId, 'patient');

        const errorEvents = emittedEvents.filter(e => e.event === 'call_error');
        assert.equal(errorEvents.length, 0, 'Assigned patient must not receive call_error');
    });

    it('should allow assigned doctor (matching via SharedUser.profileId) into consultation room', async () => {
        const useCase = new JoinRoomUseCase(mockGateway, mockAppointmentRepo);

        await useCase.execute(appointmentId, doctorUserId, 'doctor');

        const errorEvents = emittedEvents.filter(e => e.event === 'call_error');
        assert.equal(errorEvents.length, 0, 'Assigned doctor must not receive call_error');
    });

    it('should deny unassigned patient with explicit call_error event', async () => {
        const useCase = new JoinRoomUseCase(mockGateway, mockAppointmentRepo);

        await useCase.execute(appointmentId, attackerUserId, 'patient');

        const callError = emittedEvents.find(e => e.event === 'call_error');
        assert.ok(callError, 'Must emit call_error to unauthorized patient');
        assert.match(callError.data.message, /not an assigned participant/);
    });

    it('should deny unassigned doctor with explicit call_error event', async () => {
        const useCase = new JoinRoomUseCase(mockGateway, mockAppointmentRepo);

        await useCase.execute(appointmentId, attackerUserId, 'doctor');

        const callError = emittedEvents.find(e => e.event === 'call_error');
        assert.ok(callError, 'Must emit call_error to unassigned doctor');
        assert.match(callError.data.message, /not an assigned participant/);
    });

    it('should deny non-participant roles (such as admin) from joining video room', async () => {
        const useCase = new JoinRoomUseCase(mockGateway, mockAppointmentRepo);

        await useCase.execute(appointmentId, 'admin_user_99', 'admin');

        const callError = emittedEvents.find(e => e.event === 'call_error');
        assert.ok(callError, 'Admin role must not join video consultation room');
    });

    it('should verify EndRoomUseCase allows only assigned doctor to conclude consultation', async () => {
        const origApptFindById = Appointment.findById;
        Appointment.findById = () => Promise.resolve({
            _id: appointmentId,
            doctorId: new mongoose.Types.ObjectId(doctorProfileId),
            patientId: new mongoose.Types.ObjectId(patientUserId),
            status: 'scheduled'
        });

        try {
            const endUseCase = new EndRoomUseCase(mockGateway, mockAppointmentRepo, {});

            // 1. Patient attempt must throw
            await assert.rejects(
                async () => endUseCase.execute(appointmentId, patientUserId, 'patient'),
                /Only the doctor is permitted to conclude the consultation/
            );

            // 2. Unassigned doctor attempt must throw
            await assert.rejects(
                async () => endUseCase.execute(appointmentId, attackerUserId, 'doctor'),
                /Only the assigned doctor is permitted to conclude this consultation/
            );
        } finally {
            Appointment.findById = origApptFindById;
        }
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suite 3: BE-001 & BE-002 Appointment & Clinical Records Ownership Checks (Controllers)
// ──────────────────────────────────────────────────────────────────────────────
describe('P0 BE-001 & BE-002: Appointment & Clinical Endpoints Ownership Checks (Production Code)', () => {
    const patientUserId = new mongoose.Types.ObjectId().toString();
    const patientProfileId = new mongoose.Types.ObjectId().toString();
    const doctorUserId = new mongoose.Types.ObjectId().toString();
    const doctorProfileId = new mongoose.Types.ObjectId().toString();
    const attackerUserId = new mongoose.Types.ObjectId().toString();
    const appointmentId = new mongoose.Types.ObjectId().toString();

    let origApptFind;
    let origApptFindById;
    let origSharedUserFindById;
    let origConsultationFind;
    let origConsultationFindOne;
    let origConsultationFindOneAndUpdate;
    let origTxUpdate;

    const mockAppointmentDoc = {
        _id: new mongoose.Types.ObjectId(appointmentId),
        patientId: {
            _id: new mongoose.Types.ObjectId(patientUserId),
            firstName: 'Jane',
            lastName: 'Doe',
            googleName: 'Jane Doe',
            email: 'jane@example.com',
            profileId: new mongoose.Types.ObjectId(patientProfileId)
        },
        doctorId: {
            _id: new mongoose.Types.ObjectId(doctorProfileId),
            firstName: 'Doctor',
            lastName: 'Smith',
            specialty: 'Cardiology'
        },
        status: 'scheduled',
        consultationType: 'offline',
        offlineOTP: '4321',
        clinicalNotes: 'Sensitive doctor observation notes',
        prescriptions: [{ medicineName: 'Amoxicillin', dosage: '500mg' }],
        consultationFiles: [],
        toObject() {
            return {
                ...this,
                patientId: { ...this.patientId },
                doctorId: { ...this.doctorId },
                prescriptions: [...this.prescriptions],
                consultationFiles: [...this.consultationFiles]
            };
        },
        save: async function () { return this; }
    };

    beforeEach(() => {
        origApptFind = Appointment.find;
        origApptFindById = Appointment.findById;
        origSharedUserFindById = SharedUser.findById;
        origConsultationFind = ConsultationRecord.find;
        origConsultationFindOne = ConsultationRecord.findOne;
        origConsultationFindOneAndUpdate = ConsultationRecord.findOneAndUpdate;
        origTxUpdate = MongoTransactionRepository.prototype.updateStatusByAppointmentId;

        MongoTransactionRepository.prototype.updateStatusByAppointmentId = () => Promise.resolve();
        Appointment.find = () => chainableQuery([]);
        Appointment.findById = (id) => chainableQuery(mockAppointmentDoc);
        ConsultationRecord.find = () => chainableQuery([]);
        ConsultationRecord.findOne = () => chainableQuery(null);
        ConsultationRecord.findOneAndUpdate = () => chainableQuery(null);

        SharedUser.findById = (id) => {
            const idStr = String(id);
            if (idStr === doctorUserId) {
                return chainableQuery({ _id: doctorUserId, role: 'doctor', profileId: new mongoose.Types.ObjectId(doctorProfileId) });
            }
            if (idStr === patientUserId) {
                return chainableQuery({ _id: patientUserId, role: 'patient', profileId: new mongoose.Types.ObjectId(patientProfileId) });
            }
            return chainableQuery({ _id: idStr, role: 'patient', profileId: null });
        };
    });

    afterEach(() => {
        MongoTransactionRepository.prototype.updateStatusByAppointmentId = origTxUpdate;
        Appointment.find = origApptFind;
        Appointment.findById = origApptFindById;
        SharedUser.findById = origSharedUserFindById;
        ConsultationRecord.find = origConsultationFind;
        ConsultationRecord.findOne = origConsultationFindOne;
        ConsultationRecord.findOneAndUpdate = origConsultationFindOneAndUpdate;
    });

    it('getAppointmentById: allows assigned patient and strips private clinical notes', async () => {
        const req = {
            params: { id: appointmentId },
            user: { id: patientUserId, role: 'patient' }
        };
        const res = createMockRes();

        // Directly invokes production controller
        await getAppointmentById(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.appointment.clinicalNotes, undefined, 'Patient must not see clinicalNotes');
        assert.ok(res.body.appointment.prescriptions.length > 0, 'Prescriptions remain accessible');
    });

    it('getAppointmentById: allows assigned doctor and preserves private clinical notes', async () => {
        const req = {
            params: { id: appointmentId },
            user: { id: doctorUserId, role: 'doctor' }
        };
        const res = createMockRes();

        await getAppointmentById(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.appointment.clinicalNotes, 'Sensitive doctor observation notes');
    });

    it('getAppointmentById: rejects unassigned user with 403', async () => {
        const req = {
            params: { id: appointmentId },
            user: { id: attackerUserId, role: 'patient' }
        };
        const res = createMockRes();

        await getAppointmentById(req, res);

        assert.equal(res.statusCode, 403);
        assert.match(res.body.message, /Access denied/);
    });

    it('getClinicalContext: allows assigned doctor and rejects unassigned doctor or patient', async () => {
        // 1. Assigned doctor -> 200
        const reqAssigned = {
            params: { id: appointmentId },
            user: { id: doctorUserId, role: 'doctor' }
        };
        const resAssigned = createMockRes();
        await getClinicalContext(reqAssigned, resAssigned);
        assert.equal(resAssigned.statusCode, 200);
        assert.equal(resAssigned.body.success, true);

        // 2. Unassigned doctor -> 403
        const reqUnassignedDoc = {
            params: { id: appointmentId },
            user: { id: attackerUserId, role: 'doctor' }
        };
        const resUnassignedDoc = createMockRes();
        await getClinicalContext(reqUnassignedDoc, resUnassignedDoc);
        assert.equal(resUnassignedDoc.statusCode, 403);
        assert.match(resUnassignedDoc.body.message, /Not assigned to this appointment/);

        // 3. Patient role -> 403
        const reqPatient = {
            params: { id: appointmentId },
            user: { id: patientUserId, role: 'patient' }
        };
        const resPatient = createMockRes();
        await getClinicalContext(reqPatient, resPatient);
        assert.equal(resPatient.statusCode, 403);
        assert.match(resPatient.body.message, /Doctor clinical privileges required/);
    });

    it('saveClinicalNotes: rejects unassigned doctor with 403 and updates for assigned doctor', async () => {
        // 1. Unassigned doctor attempt
        const reqUnauthorized = {
            params: { id: appointmentId },
            body: { notes: 'Tampered notes' },
            user: { id: attackerUserId, role: 'doctor' }
        };
        const resUnauthorized = createMockRes();
        await saveClinicalNotes(reqUnauthorized, resUnauthorized);
        assert.equal(resUnauthorized.statusCode, 403);

        // 2. Assigned doctor attempt
        const reqAuthorized = {
            params: { id: appointmentId },
            body: { notes: 'Updated valid notes' },
            user: { id: doctorUserId, role: 'doctor' }
        };
        const resAuthorized = createMockRes();
        await saveClinicalNotes(reqAuthorized, resAuthorized);
        assert.equal(resAuthorized.statusCode, 200);
        assert.equal(resAuthorized.body.clinicalNotes, 'Updated valid notes');
    });

    it('savePrescriptions: rejects unassigned doctor with 403 and saves for assigned doctor', async () => {
        const reqUnauthorized = {
            params: { id: appointmentId },
            body: { prescriptions: [{ medicineName: 'Ibuprofen', dosage: '400mg' }] },
            user: { id: attackerUserId, role: 'doctor' }
        };
        const resUnauthorized = createMockRes();
        await savePrescriptions(reqUnauthorized, resUnauthorized);
        assert.equal(resUnauthorized.statusCode, 403);

        const reqAuthorized = {
            params: { id: appointmentId },
            body: { prescriptions: [{ medicineName: 'Ibuprofen', dosage: '400mg' }] },
            user: { id: doctorUserId, role: 'doctor' }
        };
        const resAuthorized = createMockRes();
        await savePrescriptions(reqAuthorized, resAuthorized);
        assert.equal(resAuthorized.statusCode, 200);
        assert.equal(resAuthorized.body.success, true);
    });

    it('completeOfflineAppointment: rejects unassigned doctor and accepts assigned doctor with valid OTP', async () => {
        // 1. Unassigned doctor with valid OTP
        const reqUnassigned = {
            params: { id: appointmentId },
            body: { otp: '4321' },
            user: { id: attackerUserId, role: 'doctor' }
        };
        const resUnassigned = createMockRes();
        await completeOfflineAppointment(reqUnassigned, resUnassigned);
        assert.equal(resUnassigned.statusCode, 403);
        assert.match(resUnassigned.body.message, /Not authorized/);

        // 2. Assigned doctor with valid OTP
        const reqAssigned = {
            params: { id: appointmentId },
            body: { otp: '4321' },
            user: { id: doctorUserId, role: 'doctor' }
        };
        const resAssigned = createMockRes();
        await completeOfflineAppointment(reqAssigned, resAssigned);
        assert.equal(resAssigned.statusCode, 200);
        assert.equal(resAssigned.body.success, true);
    });

    it('updateAppointmentStatus: rejects unassigned doctor with 403', async () => {
        const reqUnassigned = {
            params: { id: appointmentId },
            body: { status: 'completed' },
            user: { id: attackerUserId, role: 'doctor' }
        };
        const resUnassigned = createMockRes();
        await updateAppointmentStatus(reqUnassigned, resUnassigned);
        assert.equal(resUnassigned.statusCode, 403);
        assert.match(resUnassigned.body.message, /Forbidden/);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suite 4: INT-007 Public Slot Availability Sanitization (Real Controller)
// ──────────────────────────────────────────────────────────────────────────────
describe('P0 INT-007: Slot Availability Sanitization (Production getAvailableSlots)', () => {
    let origDoctorFindById;
    let origApptFind;
    let origOverrideFind;
    let origSharedUserFindOne;

    const doctorProfileId = new mongoose.Types.ObjectId().toString();

    beforeEach(() => {
        origDoctorFindById = Doctor.findById;
        origApptFind = Appointment.find;
        origOverrideFind = DoctorSlotOverride.find;
        origSharedUserFindOne = SharedUser.findOne;

        SharedUser.findOne = () => chainableQuery({ accountStatus: 'active', role: 'doctor' });

        Doctor.findById = () => chainableQuery({
            _id: new mongoose.Types.ObjectId(doctorProfileId),
            isProfileCompleted: true,
            isVerifiedByAdmin: true,
            verificationStatus: 'approved',
            isBlocked: false,
            slotDuration: 30,
            consultationSettings: {
                online: { enabled: true },
                offline: { enabled: false }
            },
            workingHours: {
                online: {
                    mondayToFriday: [{ start: '09:00 AM', end: '11:00 AM' }]
                }
            }
        });

        Appointment.find = () => chainableQuery([
            {
                appointmentDate: new Date('2026-10-15T00:00:00.000Z'),
                appointmentTime: '09:00 AM',
                status: 'locked',
                lockedBy: new mongoose.Types.ObjectId(), // Internal patient ID
                razorpayOrderId: 'order_secret_xyz123',  // Internal Razorpay order
                _id: new mongoose.Types.ObjectId(),      // Internal appointment ID
                consultationType: 'online'
            }
        ]);

        DoctorSlotOverride.find = () => chainableQuery([]);
    });

    afterEach(() => {
        Doctor.findById = origDoctorFindById;
        Appointment.find = origApptFind;
        DoctorSlotOverride.find = origOverrideFind;
        SharedUser.findOne = origSharedUserFindOne;
    });

    it('should never expose lockedBy, razorpayOrderId, or appointmentId in public slot objects', async () => {
        const req = {
            params: { doctorId: doctorProfileId },
            query: { date: '2026-10-15' }
        };
        const res = createMockRes();

        // Directly invokes production getAvailableSlots
        await getAvailableSlots(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.ok(Array.isArray(res.body.allSlots), 'allSlots must be an array');
        assert.ok(res.body.allSlots.length > 0, 'Must generate slots');

        // Verify EVERY slot object in the public response
        for (const slot of res.body.allSlots) {
            assert.equal(slot.lockedBy, undefined, 'Must not expose lockedBy');
            assert.equal(slot.razorpayOrderId, undefined, 'Must not expose razorpayOrderId');
            assert.equal(slot.appointmentId, undefined, 'Must not expose appointmentId');
            assert.ok(slot.time, 'Slot time must be preserved');
            assert.ok('status' in slot, 'Slot status must be preserved');
            assert.ok('available' in slot, 'Slot availability flag must be preserved');
        }
    });
});
