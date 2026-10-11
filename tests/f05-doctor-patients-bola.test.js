// zydoc-backend/tests/f05-doctor-patients-bola.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

// ── Production Controller Import ──────────────────────────────────────────────
import { DoctorPatientsController } from '../src/presentation/controllers/DoctorPatientsController.js';
import SharedUser from '../src/infrastructure/database/models/SharedUser.js';
import Appointment from '../src/infrastructure/database/models/Appointment.js';

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
// Suite: F-05 DoctorPatientsController BOLA & Clinical Authorization
// ──────────────────────────────────────────────────────────────────────────────
describe('F-05: DoctorPatientsController BOLA & Clinical Authorization (Production Code)', () => {
    let controller;

    const doctorUserId = new mongoose.Types.ObjectId().toString();
    const doctorProfileId = new mongoose.Types.ObjectId().toString();

    const strangerDoctorUserId = new mongoose.Types.ObjectId().toString();
    const strangerDoctorProfileId = new mongoose.Types.ObjectId().toString();

    const patientUserId = new mongoose.Types.ObjectId().toString();
    const patientProfileId = new mongoose.Types.ObjectId().toString();

    const appointmentId = new mongoose.Types.ObjectId().toString();

    let origSharedUserFindById;
    let origSharedUserFindOne;
    let origAppointmentFind;
    let origAppointmentAggregate;

    const mockPatientSharedUserDoc = {
        _id: new mongoose.Types.ObjectId(patientUserId),
        email: 'patient.private@example.com',
        googleName: 'John Patient',
        googleAvatarUrl: 'https://example.com/avatar.jpg',
        profileId: {
            _id: new mongoose.Types.ObjectId(patientProfileId),
            firstName: 'John',
            lastName: 'Patient',
            phone: '+1-555-0199-CONFIDENTIAL',
            gender: 'Male',
            bloodGroup: 'O+',
            dateOfBirth: new Date('1990-01-01'),
            avatarUrl: 'https://example.com/avatar.jpg',
            medicalHistory: {
                allergies: ['Penicillin', 'Peanuts'],
                chronicConditions: ['Hypertension'],
                currentMedications: ['Lisinopril 10mg']
            },
            emergencyContact: {
                name: 'Jane Patient',
                phone: '+1-555-0198'
            }
        }
    };

    const mockQualifyingAppointment = {
        _id: new mongoose.Types.ObjectId(appointmentId),
        appointmentId: new mongoose.Types.ObjectId(appointmentId),
        doctorId: new mongoose.Types.ObjectId(doctorProfileId),
        patientId: new mongoose.Types.ObjectId(patientUserId),
        appointmentDate: new Date('2026-10-12'),
        appointmentTime: '10:00 AM',
        consultationType: 'online',
        status: 'completed',
        fee: 500,
        feeBreakdown: { totalFee: 500 },
        clinicalNotes: 'Patient recovering well.',
        prescriptions: [{ medicineName: 'Lisinopril', dosage: '10mg' }],
        consultationFiles: [{ fileName: 'ecg_report.pdf', fileUrl: 'https://example.com/ecg.pdf' }],
        sessionStartedAt: new Date('2026-10-12T10:00:00Z'),
        sessionEndedAt: new Date('2026-10-12T10:30:00Z'),
        createdAt: new Date('2026-10-10T08:00:00Z')
    };

    beforeEach(() => {
        controller = new DoctorPatientsController();

        origSharedUserFindById = SharedUser.findById;
        origSharedUserFindOne = SharedUser.findOne;
        origAppointmentFind = Appointment.find;
        origAppointmentAggregate = Appointment.aggregate;

        // Mock SharedUser.findById
        SharedUser.findById = (id) => {
            const idStr = String(id);
            if (idStr === doctorUserId) {
                return chainableQuery({
                    _id: new mongoose.Types.ObjectId(doctorUserId),
                    role: 'doctor',
                    profileId: new mongoose.Types.ObjectId(doctorProfileId)
                });
            }
            if (idStr === strangerDoctorUserId) {
                return chainableQuery({
                    _id: new mongoose.Types.ObjectId(strangerDoctorUserId),
                    role: 'doctor',
                    profileId: new mongoose.Types.ObjectId(strangerDoctorProfileId)
                });
            }
            if (idStr === patientUserId) {
                return chainableQuery(mockPatientSharedUserDoc);
            }
            return chainableQuery(null);
        };

        SharedUser.findOne = () => chainableQuery(null);
    });

    afterEach(() => {
        SharedUser.findById = origSharedUserFindById;
        SharedUser.findOne = origSharedUserFindOne;
        Appointment.find = origAppointmentFind;
        Appointment.aggregate = origAppointmentAggregate;
    });

    it('1. A doctor with no qualifying relationship CANNOT retrieve patient demographics or medical history (HTTP 403)', async () => {
        // Stranger doctor has 0 appointments with this patient
        Appointment.find = () => chainableQuery([]);

        const req = {
            params: { patientId: patientUserId },
            user: { id: strangerDoctorUserId, role: 'doctor' }
        };
        const res = createMockRes();

        // Directly invokes production controller method
        await controller.getPatientHistory(req, res);

        assert.equal(res.statusCode, 403, 'Must return 403 Forbidden for unrelated doctor');
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /Access denied/i);
        assert.match(res.body.message, /clinical relationship/i);

        // Crucial BOLA verification: No sensitive patient data leaked
        assert.equal(res.body.patient, undefined, 'Sensitive patient profile MUST NOT be present in response');
        assert.equal(res.body.consultations, undefined, 'Consultations MUST NOT be present in response');
    });

    it('2. A doctor with a legitimate qualifying relationship retains intended access (HTTP 200)', async () => {
        // Assigned doctor has a completed appointment with this patient
        Appointment.find = () => chainableQuery([mockQualifyingAppointment]);

        const req = {
            params: { patientId: patientUserId },
            user: { id: doctorUserId, role: 'doctor' }
        };
        const res = createMockRes();

        await controller.getPatientHistory(req, res);

        assert.equal(res.statusCode, 200, 'Must allow assigned doctor with qualifying relationship');
        assert.equal(res.body.success, true);
        assert.ok(res.body.patient, 'Authorized doctor must receive patient overview');
        assert.equal(res.body.patient.name, 'John Patient');
        assert.equal(res.body.patient.phone, '+1-555-0199-CONFIDENTIAL');
        assert.deepEqual(res.body.patient.allergies, ['Penicillin', 'Peanuts']);
        assert.deepEqual(res.body.patient.chronicConditions, ['Hypertension']);
        assert.equal(res.body.totalVisits, 1);
        assert.equal(res.body.consultations.length, 1);
        assert.equal(res.body.consultations[0].clinicalNotes, 'Patient recovering well.');
    });

    it('3. An unauthorized role (e.g., patient) cannot use the doctor-only endpoint (HTTP 403)', async () => {
        const req = {
            params: { patientId: patientUserId },
            user: { id: patientUserId, role: 'patient' }
        };
        const res = createMockRes();

        await controller.getPatientHistory(req, res);

        assert.equal(res.statusCode, 403, 'Must reject patient role with 403');
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /Doctor privileges required/i);
        assert.equal(res.body.patient, undefined, 'No patient data leaked');
    });

    it('4. Authorization failure does not return sensitive patient fields even if patient exists', async () => {
        Appointment.find = () => chainableQuery([]);

        const req = {
            params: { patientId: patientUserId },
            user: { id: strangerDoctorUserId, role: 'doctor' }
        };
        const res = createMockRes();

        await controller.getPatientHistory(req, res);

        assert.equal(res.statusCode, 403);
        const serialized = JSON.stringify(res.body);
        assert.ok(!serialized.includes('+1-555-0199-CONFIDENTIAL'), 'Phone number must not appear in error payload');
        assert.ok(!serialized.includes('Hypertension'), 'Chronic conditions must not appear in error payload');
        assert.ok(!serialized.includes('Penicillin'), 'Allergies must not appear in error payload');
        assert.ok(!serialized.includes('Lisinopril'), 'Medications must not appear in error payload');
    });

    it('5. Scheduled (upcoming) appointments qualify as legitimate clinical relationship', async () => {
        const scheduledAppointment = {
            ...mockQualifyingAppointment,
            status: 'scheduled',
            clinicalNotes: ''
        };
        Appointment.find = () => chainableQuery([scheduledAppointment]);

        const req = {
            params: { patientId: patientUserId },
            user: { id: doctorUserId, role: 'doctor' }
        };
        const res = createMockRes();

        await controller.getPatientHistory(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.totalVisits, 1);
        assert.equal(res.body.consultations[0].status, 'scheduled');
    });

    it('6. getMyPatients rejects unauthorized roles with HTTP 403', async () => {
        const req = {
            query: {},
            user: { id: patientUserId, role: 'patient' }
        };
        const res = createMockRes();

        await controller.getMyPatients(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.success, false);
        assert.match(res.body.message, /Doctor privileges required/i);
    });
});
