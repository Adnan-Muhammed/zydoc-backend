import mongoose from "mongoose";
import Appointment from "./src/infrastructure/database/models/Appointment.js";
import dotenv from "dotenv";

dotenv.config();

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    
    const year = 2026;
    const month = 8;
    const day = 4;
    const startOfDayUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    const endOfDayUTC   = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));

    // Create a dummy locked appointment
    const dummy = await Appointment.create({
        patientId: new mongoose.Types.ObjectId(),
        doctorId: new mongoose.Types.ObjectId("6a6b6b75296020e4a57e0953"), // dummy doctor ID
        appointmentDate: startOfDayUTC, // 2026-08-04
        appointmentTime: "10:00",
        consultationType: "video",
        status: "locked",
        fee: 500,
        lockExpiryTime: new Date(Date.now() + 5 * 60 * 1000)
    });

    console.log("Created lock:", dummy._id);

    // Now simulate getAvailableSlots
    const existingAppointments = await Appointment.find({
        doctorId: dummy.doctorId,
        appointmentDate: { $gte: startOfDayUTC, $lte: endOfDayUTC },
        $or: [
            { status: { $in: ['scheduled', 'completed'] } },
            { status: 'locked', lockExpiryTime: { $gt: new Date() } }
        ]
    });

    console.log("Found existing:", existingAppointments.length);
    if (existingAppointments.length > 0) {
        console.log("Appointment time:", existingAppointments[0].appointmentTime);
    }
    
    await Appointment.deleteOne({ _id: dummy._id });
    console.log("Cleaned up");
    process.exit(0);
}
run();
