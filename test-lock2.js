import mongoose from "mongoose";
import Appointment from "./src/infrastructure/database/models/Appointment.js";
import dotenv from "dotenv";

dotenv.config();

async function run() {
    await mongoose.connect(process.env.MONGO_URI);
    const existingAppointments = await Appointment.find({
        status: 'locked'
    });
    console.log("Found locked:");
    existingAppointments.forEach(app => console.log(app.appointmentDate, app.appointmentTime, app.status, app.lockExpiryTime));
    process.exit(0);
}
run();
