import mongoose from "mongoose";
import SharedUser from "./src/infrastructure/database/models/SharedUser.js";
import Doctor from "./src/infrastructure/database/models/DoctorProfile.js";

const MONGO_URI = "mongodb://127.0.0.1:27017/zydoc-app";

async function updateDoctorSlot(addMins = 2) {
    try {
        await mongoose.connect(MONGO_URI);
        const doctorUser = await SharedUser.findOne({ email: "final@gmail.com", role: "doctor" });
        if (!doctorUser || !doctorUser.profileId) {
            console.error("Doctor final@gmail.com not found or missing profileId");
            return;
        }

        const doctor = await Doctor.findById(doctorUser.profileId);
        if (!doctor) {
            console.error("Doctor profile not found.");
            return;
        }
        
        const now = new Date();
        now.setMinutes(now.getMinutes() + addMins);
        
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        const startTimeString = `${hours}:${minutes}`;

        // Calculate end time for exactly 10 slots (10 * 40 mins = 400 mins)
        const endTimeDate = new Date(now);
        endTimeDate.setMinutes(endTimeDate.getMinutes() + 400);
        
        const endHours = endTimeDate.getHours().toString().padStart(2, '0');
        const endMinutes = endTimeDate.getMinutes().toString().padStart(2, '0');
        const endTimeString = `${endHours}:${endMinutes}`;

        console.log(`Setting doctor online working hours: ${startTimeString} to ${endTimeString} (Exact 10 slots)`);

        const days = ['mondayToFriday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        
        if (!doctor.workingHours) {
            doctor.workingHours = {};
        }
        if (!doctor.workingHours.online) {
            doctor.workingHours.online = {};
        }

        for (const day of days) {
            if (!doctor.workingHours.online[day]) {
                doctor.workingHours.online[day] = {};
            }
            doctor.workingHours.online[day].active = true;
            doctor.workingHours.online[day].start = startTimeString;
            doctor.workingHours.online[day].end = endTimeString;
        }
        
        await doctor.save();
        console.log("Doctor slot updated successfully!");
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await mongoose.disconnect();
    }
}




const minTime = 2;

updateDoctorSlot(minTime);
 
