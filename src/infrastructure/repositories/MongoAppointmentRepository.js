import mongoose from "mongoose";
import { AppointmentRepository } from "../../domain/repositories/AppointmentRepository.js";
import Appointment from "../database/models/Appointment.js";
import Doctor from "../database/models/DoctorProfile.js";
import SharedUser from "../database/models/SharedUser.js";

export class MongoAppointmentRepository extends AppointmentRepository {
    async lockSlot(lockData) {
        const existing = await Appointment.findOne({
            doctorId: lockData.doctorId,
            appointmentDate: lockData.appointmentDate,
            appointmentTime: lockData.appointmentTime,
            status: { $in: ['locked', 'scheduled', 'completed'] }
        });

        if (existing) {
            return null;
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
        return await Appointment.find({ doctorId })
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
                fee: appointment.fee,
                reason: appointment.notes
            }
        };
    }
}
