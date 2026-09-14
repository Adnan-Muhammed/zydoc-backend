import mongoose from "mongoose";
import { AppointmentRepository } from "../../domain/repositories/AppointmentRepository.js";
import Appointment from "../database/models/Appointment.js";
import Doctor from "../database/models/DoctorProfile.js";
import SharedUser from "../database/models/SharedUser.js";
import { getUTCDayBounds, getSlotExactUTC, parseTimeStr } from "../utils/timeUtils.js";
import { razorpayRefund } from "../services/RazorpayService.js";
import Transaction from "../database/models/Transaction.js";

export class MongoAppointmentRepository extends AppointmentRepository {
    async findById(appointmentId) {
        return await Appointment.findById(appointmentId);
    }

    async lockSlot(lockData) {
        const currentTime = new Date();
        const { startOfDayUTC } = getUTCDayBounds(lockData.appointmentDate);
        const slotDuration = Number(lockData.slotDuration) || 15;

        const candidateParsed = parseTimeStr(lockData.appointmentTime);

        // ── Phase 1: Overlap guard ───────────────────────────────────────────────
        // Uses strict UTC Date inequalities on the pre-computed scheduledStartAt /
        // scheduledEndAt fields — no string parsing, no timezone offset arithmetic.
        // Two intervals [A_start, A_end) and [B_start, B_end) overlap when:
        //   A_start < B_end  AND  A_end > B_start
        // which maps directly to the two $lt / $gt conditions below.
        const doctorTimezone = lockData.doctorTimezone || lockData.timezone || 'Asia/Kolkata';
        const candidateStartUTC = lockData.scheduledStartAt 
            ? new Date(lockData.scheduledStartAt) 
            : getSlotExactUTC(lockData.appointmentDate, lockData.appointmentTime, doctorTimezone);
        const candidateEndUTC = lockData.scheduledEndAt 
            ? new Date(lockData.scheduledEndAt) 
            : new Date(candidateStartUTC.getTime() + slotDuration * 60 * 1000);

        const existingAppointments = await Appointment.find({
            doctorId: lockData.doctorId,
            appointmentDate: startOfDayUTC,
            $or: [
                { status: { $in: ['scheduled', 'completed'] } },
                { status: 'locked', lockExpiryTime: { $gt: currentTime } },
            ],
            // Overlap condition on stored UTC timestamps
            scheduledStartAt: { $lt: candidateEndUTC },
            scheduledEndAt:   { $gt: candidateStartUTC },
        }).lean();

        for (const app of existingAppointments) {
            // Same patient re-hitting a lock they already hold → idempotent return
            if (
                app.status === 'locked' &&
                app.lockedBy?.toString() === lockData.patientId.toString() &&
                new Date(app.lockExpiryTime) > currentTime
            ) {
                return await Appointment.findById(app._id); // return full Mongoose doc
            }

            // Genuine conflict — occupied by another patient or already scheduled
            return null;
        }

        // ── Phase 2: Atomic upsert ───────────────────────────────────────────────
        // Mark any expired lock for this exact slot as 'expired' BEFORE the upsert
        // so it no longer occupies the unique partial index slot.
        // IMPORTANT: We use updateOne (not deleteOne) so the document — and its
        // razorpayOrderId — is preserved. If Razorpay later delivers a webhook for
        // this payment, VerifyPayment can still find the record and issue a refund.
        await Appointment.updateOne(
            {
                doctorId: lockData.doctorId,
                appointmentDate: startOfDayUTC,
                appointmentTime: lockData.appointmentTime,
                status: 'locked',
                lockExpiryTime: { $lte: currentTime },
            },
            { $set: { status: 'expired' } }
        );

        // Single atomic operation: insert a new locked document.
        // Protected by the unique partial index `unique_active_slot_per_doctor`
        // (doctorId + appointmentDate + appointmentTime) on active statuses ['locked', 'scheduled', 'completed'].
        // Cancelled / expired records are excluded from the index, allowing vacated slots to be re-booked.
        // If two users race at the exact same millisecond, MongoDB's WiredTiger engine guarantees
        // that only ONE create succeeds; the second raises an E11000 duplicate-key error, which we catch
        // and translate to null — which LockSlot.js handles by alerting the user that the slot was locked.
        try {
            const newDoc = await Appointment.create({
                ...lockData,
                appointmentDate: startOfDayUTC,
                status: 'locked',
                lockedBy: lockData.patientId,
            });
            return newDoc;
        } catch (err) {
            // E11000 = duplicate key — a concurrent request won the race and already
            // inserted an active (locked/scheduled/completed) record for this slot.
            if (err.code === 11000) {
                return null;
            }
            throw err; // surface unexpected DB errors
        }
    }

    async unlockSlot(payload, userId) {
        // Patient-initiated explicit unlock: safe to hard-delete because the
        // patient is abandoning the slot before any payment attempt.
        let query = { lockedBy: userId, status: 'locked' };

        if (typeof payload === 'string' || payload instanceof mongoose.Types.ObjectId) {
            query._id = payload;
        } else {
            const { startOfDayUTC } = getUTCDayBounds(payload.date);
            query.doctorId = payload.doctorId;
            query.appointmentDate = startOfDayUTC;
            query.appointmentTime = payload.time;
        }

        return await Appointment.findOneAndDelete(query);
    }

    // Called exclusively by the cron job for TTL-expired locks.
    // Marks the appointment 'expired' instead of deleting it so that
    // VerifyPayment can still find the record by razorpayOrderId and
    // trigger a refund if Razorpay captured money after the TTL elapsed.
    async expireLockedSlot(appointmentId) {
        return await Appointment.findOneAndUpdate(
            { _id: appointmentId, status: 'locked' },
            { $set: { status: 'expired' } },
            { returnDocument: 'after' }
        );
    }

    async extendLock(slotId, userId, additionalMinutes) {
        return await Appointment.findOneAndUpdate(
            { _id: slotId, lockedBy: userId, status: 'locked' },
            { $set: { lockExpiryTime: new Date(Date.now() + additionalMinutes * 60 * 1000) } },
            { returnDocument: 'after' }
        );
    }

    async confirmBooking(slotId, userId, updateData) {
        return await Appointment.findOneAndUpdate(
            { _id: slotId, lockedBy: userId, status: 'locked' },
            { $set: { status: 'scheduled', ...updateData } },
            { returnDocument: 'after' }
        );
    }

    async findExpiredLocks(currentTime) {
        return await Appointment.find({
            status: 'locked',
            lockExpiryTime: { $lt: currentTime }
        });
    }

    async findByPatientIdWithDoctorDetails(patientId) {
        return await Appointment.find({ patientId })
            .populate('doctorId', 'firstName lastName avatarUrl specialty consultationSettings slotDuration')
            .sort({ appointmentDate: -1 });
    }

    async findByDoctorIdWithPatientDetails(doctorId) {
        return await Appointment.find({ 
            doctorId,
            status: { $in: ['scheduled', 'completed', 'no-show', 'cancelled', 'cancelled-by-doctor', 'disputed', 'refunded'] }
        })
            .populate({
                path: 'patientId',
                select: 'email profileId roleModel googleName googleAvatarUrl',
                populate: {
                    path: 'profileId',
                    select: 'firstName lastName avatarUrl dateOfBirth gender phone bloodGroup medicalHistory'
                }
            })
            .sort({ appointmentDate: 1, appointmentTime: 1 });
    }

    async findDoctorHistoryWithPatientDetails(doctorId) {
        return await Appointment.find({
            doctorId,
            status: { $in: ['completed', 'no-show', 'cancelled', 'cancelled-by-doctor', 'refunded'] }
        })
            .populate({
                path: 'patientId',
                select: 'email profileId roleModel googleName googleAvatarUrl',
                populate: {
                    path: 'profileId',
                    select: 'firstName lastName avatarUrl dateOfBirth gender phone bloodGroup medicalHistory'
                }
            })
            .sort({ appointmentDate: -1, appointmentTime: -1 });
    }

    async lazyUpdateNoShows(filter = {}) {
        const now = new Date();

        // Only process ONLINE/VIDEO appointments. Offline appointments are
        // handled exclusively by the midnight OfflineNoShowCron to prevent
        // premature status changes for in-person visits.
        let query = {
            status: 'scheduled',
            consultationType: { $in: ['online', 'video'] },
        };
        if (typeof filter === 'string' || filter instanceof mongoose.Types.ObjectId) {
            query.doctorId = filter;
        } else if (filter && typeof filter === 'object') {
            if (filter.doctorId) query.doctorId = filter.doctorId;
            if (filter.patientId) query.patientId = filter.patientId;
        }

        // Fetch Scheduled appointments matching the filter
        const scheduledAppointments = await Appointment.find(query).populate('doctorId', 'slotDuration');

        const expiredAppointments = scheduledAppointments.filter(app => {
            const dateStr = app.appointmentDate ? new Date(app.appointmentDate).toISOString().split('T')[0] : null;
            if (!dateStr || !app.appointmentTime) return false;

            const slotDurationMins = Number(app.doctorId?.slotDuration) || 15;
            // Calculate exact UTC start and end times
            const slotExactUTC = app.scheduledStartAt ? new Date(app.scheduledStartAt) : getSlotExactUTC(dateStr, app.appointmentTime, app.doctorTimezone || 'Asia/Kolkata');
            const slotEndUTC = app.scheduledEndAt ? new Date(app.scheduledEndAt) : new Date(slotExactUTC.getTime() + slotDurationMins * 60 * 1000);

            return now > slotEndUTC;
        });

        for (const app of expiredAppointments) {
            // Task 2: Online Doctor No-Show Check
            // If patient joined (patientJoinedAt is NOT null) BUT doctor did NOT join (doctorJoinedAt is null)
            if (app.patientJoinedAt && !app.doctorJoinedAt) {
                console.log(`[lazyUpdateNoShows] Doctor No-Show detected for online appointment ${app._id}. Marking as refund_pending...`);
                app.status = 'refund_pending';
                app.paymentStatus = 'paid'; // Keep as paid until admin approves
                app.cancellationReason = 'Doctor failed to attend the scheduled consultation';
                await app.save();
                
                // Do NOT trigger razorpay auto-refund or cancel transaction here.
                // Leave it for Admin manual review under /refunds
            } else if (!app.patientJoinedAt) {
                // Patient failed to show up -> mark standard 'no-show'
                app.status = 'no-show';
                await app.save();
                console.log(`[lazyUpdateNoShows] Patient missed appointment ${app._id}, marked as no-show.`);
            }
        }
    }

    async findDisputedAppointments() {
        // Fetch disputed and pending refund online cases
        const disputedList = await Appointment.find({ status: { $in: ['disputed', 'refund_pending'] } })
            .populate({
                path: 'patientId',
                select: 'email profileId roleModel googleName googleAvatarUrl',
                populate: {
                    path: 'profileId',
                    select: 'firstName lastName avatarUrl phone dateOfBirth gender'
                }
            })
            .populate('doctorId', 'firstName lastName avatarUrl specialty phone consultationSettings')
            .sort({ disputedAt: -1, appointmentDate: -1 })
            .lean(); // Lean for injection

        // Cross-check for overlapping online calls
        for (const app of disputedList) {
            app.hasOnlineOverlapAlert = false;
            app.overlappingOnlineAppointments = [];

            if (['offline', 'physical'].includes(app.consultationType) && app.scheduledStartAt && app.scheduledEndAt) {
                const overlaps = await Appointment.find({
                    doctorId: app.doctorId._id,
                    _id: { $ne: app._id },
                    consultationType: { $in: ['online', 'video'] },
                    // overlap condition: (StartA <= EndB) and (EndA >= StartB)
                    // we use sessionStartedAt / sessionEndedAt for actual overlap
                    sessionStartedAt: { $lte: app.scheduledEndAt },
                    $or: [
                        { sessionEndedAt: { $gte: app.scheduledStartAt } },
                        { sessionEndedAt: { $exists: false } } // Still ongoing
                    ]
                }).lean();

                if (overlaps && overlaps.length > 0) {
                    app.hasOnlineOverlapAlert = true;
                    app.overlappingOnlineAppointments = overlaps;
                }
            }
        }

        return disputedList;
    }


    async findAllWithDetails() {
        return await Appointment.find({ status: { $ne: 'locked' } })
            .populate({
                path: 'patientId',
                select: 'email profileId roleModel googleName googleAvatarUrl',
                populate: {
                    path: 'profileId',
                    select: 'firstName lastName avatarUrl dateOfBirth gender phone bloodGroup medicalHistory'
                }
            })
            .populate('doctorId', 'firstName lastName avatarUrl specialty consultationSettings')
            .sort({ appointmentDate: -1, appointmentTime: -1 });
    }

    async findById(id) {
        return await Appointment.findById(id);
    }

    async findByOrderId(orderId) {
        // Must match both 'locked' (concurrent webhook/frontend race) and
        // 'expired' (payment captured after TTL) so VerifyPayment can always
        // find the record and decide whether to confirm or refund.
        return await Appointment.findOne({ razorpayOrderId: orderId });
    }

    async update(id, data) {
        return await Appointment.findByIdAndUpdate(id, data, { returnDocument: 'after' });
    }

    async getBookingDetailsForEmail(appointmentId) {
        const appointment = await Appointment.findById(appointmentId)
            .populate({
                path: 'patientId',
                select: 'email profileId googleName',
                populate: { path: 'profileId', select: 'firstName lastName' }
            })
            .populate('doctorId', 'firstName lastName');
            
        if (!appointment) return null;
        
        const doctorUser = await SharedUser.findOne({ profileId: appointment.doctorId._id, role: 'doctor' });
        
        const patientName = appointment.patientId?.profileId?.firstName 
            ? `${appointment.patientId.profileId.firstName} ${appointment.patientId.profileId.lastName || ''}`.trim()
            : (appointment.patientId?.googleName || 'Patient');
            
        const doctorName = appointment.doctorId 
            ? `${appointment.doctorId.firstName} ${appointment.doctorId.lastName || ''}`.trim()
            : 'Doctor';
            
        return {
            patientEmail: appointment.patientId?.email,
            doctorEmail: doctorUser?.email,
            patientName,
            doctorName,
            bookingDetails: {
                date: appointment.appointmentDate ? new Date(appointment.appointmentDate).toDateString() : '',
                time: appointment.appointmentTime,
                type: appointment.consultationType,
                patientType: appointment.patientType,
                fee: appointment.fee,
                reason: appointment.notes
            }
        };
    }
}
