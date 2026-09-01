import mongoose from "mongoose";
import SharedUser from "./src/infrastructure/database/models/SharedUser.js";
import Appointment from "./src/infrastructure/database/models/Appointment.js";

const MONGO_URI = "mongodb://127.0.0.1:27017/zydoc-app";

// Helper to format time to "hh:mm A" matching the frontend/backend formats
function formatAMPM(date) {
  let hours = date.getHours();
  let minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  minutes = minutes < 10 ? '0' + minutes : minutes;
  const strTime = hours + ':' + minutes + ' ' + ampm;
  return strTime;
}

async function createAppointment(slotIndex = 0, doctorEmail , patientEmail) {
    try {
        await mongoose.connect(MONGO_URI);
        const doctorUser = await SharedUser.findOne({ email:doctorEmail, role: "doctor" });
        const patientUser = await SharedUser.findOne({ email: patientEmail, role: "patient" });

        if (!doctorUser || !patientUser) {
            console.error("Doctor or Patient not found.");
            return;
        }

        // Fetch Doctor Profile to get the start time
        const Doctor = (await import("./src/infrastructure/database/models/DoctorProfile.js")).default;
        const doctor = await Doctor.findById(doctorUser.profileId);
        
        if (!doctor || !doctor.workingHours || !doctor.workingHours.online || !doctor.workingHours.online.monday) {
            console.error("Doctor working hours not set. Please run docslot.js first.");
            return;
        }

        // docslot.js sets all days to the same start time, so we can just read monday's start time
        const startTimeStr = doctor.workingHours.online.monday.start; // format "HH:mm"
        const [startHour, startMin] = startTimeStr.split(':').map(Number);

        const apptDate = new Date();
        apptDate.setHours(startHour, startMin, 0, 0);
        
        // Add 40 minutes for each slot index
        apptDate.setMinutes(apptDate.getMinutes() + (slotIndex * 40));
        
        // Strip time from appointmentDate to just have the date part for MongoDB Date object
        const dateOnly = new Date(Date.UTC(apptDate.getFullYear(), apptDate.getMonth(), apptDate.getDate()));

        const formattedTime = formatAMPM(apptDate);
        
        console.log(`Booking Slot Index ${slotIndex} -> Appointment Time: ${formattedTime}`);

        const appointment = new Appointment({
            patientId: patientUser._id,
            doctorId: doctorUser.profileId, // Using profileId as requested
            appointmentDate: dateOnly,
            appointmentTime: formattedTime,
            consultationType: "video",
            patientType: "FOLLOW_UP",
            status: "scheduled",
            lockedBy: patientUser._id,
            lockExpiryTime: new Date(Date.now() + 1000 * 60 * 60 * 24), // locked for 24 hours just in case
            fee: 542,
            paymentStatus: "paid",
            notes: `Test dummy appointment created by script (Slot ${slotIndex})`,
            razorpayOrderId: `order_test_${Date.now()}`,
            adminCommission: 54.2,
            doctorAmount: 487.8,
            paymentId: `pay_test_${Date.now()}`,
        });

        await appointment.save();
        console.log("✅ Appointment created successfully! ID:", appointment._id);
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await mongoose.disconnect();
    }
}

// Change this number to test different slots
// 0 = current active slot
// 1 = next upcoming slot (40 mins later)
// 2 = second upcoming slot (80 mins later)


// "last@gmail.com"

// "beeviadeela@gmailcom"



const slot = 0;
const doctorEmail=
"final@gmail.com"

const patientEmail=
"afsal@gmail.com"
createAppointment(slot,doctorEmail,patientEmail);
