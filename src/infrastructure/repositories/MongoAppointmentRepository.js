import mongoose from "mongoose";
import { AppointmentRepository } from "../../domain/repositories/AppointmentRepository.js";
import Appointment from "../database/models/Appointment.js";
import Doctor from "../database/models/DoctorProfile.js";
import SharedUser from "../database/models/SharedUser.js";

export class MongoAppointmentRepository extends AppointmentRepository {
    async lockSlot(lockData) {
        const currentTime = new Date();
        const existing = await Appointment.findOne({
            doctorId: lockData.doctorId,
            appointmentDate: lockData.appointmentDate,
            appointmentTime: lockData.appointmentTime,
            status: { $in: ['locked', 'scheduled', 'completed'] }
        });

        if (existing) {
            if (
                existing.status === 'locked' &&
                existing.lockedBy &&
                existing.lockedBy.toString() === lockData.patientId.toString() &&
                existing.lockExpiryTime > currentTime
            ) {
                // If it's already locked by the same user and not expired, return it
                return existing;
            }

            if (existing.status === 'locked' && existing.lockExpiryTime <= currentTime) {
                // If it's an expired lock, delete it so we can create a new lock
                await Appointment.deleteOne({ _id: existing._id });
            } else {
                // Locked by someone else or already booked
                return null;
            }
        }

        const appointment = new Appointment({
            ...lockData,
            status: 'locked',
            lockedBy: lockData.patientId
        });

        return await appointment.save();
    }

    async unlockSlot(payload, userId) {
        let query = { lockedBy: userId, status: 'locked' };

        if (typeof payload === 'string' || payload instanceof mongoose.Types.ObjectId) {
            query._id = payload;
        } else {
            query.doctorId = payload.doctorId;
            query.appointmentDate = payload.date;
            query.appointmentTime = payload.time;
        }

        return await Appointment.findOneAndDelete(query);
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
            .populate('doctorId', 'firstName lastName avatarUrl specialty consultationSettings')
            .sort({ appointmentDate: -1 });
    }

    async findByDoctorIdWithPatientDetails(doctorId) {
        return await Appointment.find({ 
            doctorId,
            status: 'scheduled'
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
            status: { $in: ['completed', 'no-show'] }
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

    async lazyUpdateNoShows(doctorId) {
        const now = new Date();
        const fortyMinsInMs = 40 * 60 * 1000;
        const pastThresholdTime = new Date(now.getTime() - fortyMinsInMs);

        // Fetch Scheduled appointments to manually check time because time is stored as string 'HH:mm A'
        const scheduledAppointments = await Appointment.find({
            doctorId,
            status: 'scheduled'
        });

        const noShowIds = scheduledAppointments.filter(app => {
            const dateStr = app.appointmentDate ? new Date(app.appointmentDate).toISOString().split('T')[0] : null;
            if (!dateStr || !app.appointmentTime) return false;

            const [timeStr, modifier] = app.appointmentTime.trim().split(/\s+/);
            let [h, m] = timeStr.split(':').map(Number);
            if (isNaN(h) || isNaN(m)) return false;

            if (modifier) {
                if (modifier.toUpperCase() === 'PM' && h < 12) h += 12;
                if (modifier.toUpperCase() === 'AM' && h === 12) h = 0;
            }

            const apptDate = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
            // Compare local/UTC matching depending on how frontend saves it.
            // If date is stored at UTC midnight, and time is local, this requires exact timezone.
            // Better to use 
            //
            // if it exists or reconstruct UTC correctly.
            // Assuming the simple Date construction:
            const [year, month, day] = dateStr.split('-').map(Number);
            const slotLocal = new Date(year, month - 1, day, h, m, 0, 0);

            return slotLocal < pastThresholdTime;
        }).map(app => app._id);

        if (noShowIds.length > 0) {
            await Appointment.updateMany(
                { _id: { $in: noShowIds } },
                { $set: { status: 'no-show' } }
            );
        }
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
