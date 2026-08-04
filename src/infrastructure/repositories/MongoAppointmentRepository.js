import mongoose from "mongoose";
import { AppointmentRepository } from "../../domain/repositories/AppointmentRepository.js";
import Appointment from "../database/models/Appointment.js";

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

        return await Appointment.findOneAndUpdate(
            query,
            {
                status: 'available',
                $unset: { lockedBy: 1, lockExpiryTime: 1 }
            },
            { returnDocument: 'after' }
        );
    }

    async findExpiredLocks(currentTime) {
        return await Appointment.find({
            status: 'locked',
            lockExpiryTime: { $lt: currentTime }
        });
    }
}
