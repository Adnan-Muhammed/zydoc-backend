// import mongoose from "mongoose";
// import Appointment from "./src/infrastructure/database/models/Appointment.js";

// const MONGODB_URI = "mongodb://127.0.0.1:27017/zydoc-app";

// function formatTimeOnly(dateObj) {
//   if (!dateObj) return "N/A";
  
//   return dateObj.toLocaleTimeString("en-US", {
//     hour: "numeric",
//     minute: "2-digit",
//     hour12: true,
//   });
// }

// async function run() {
//   try {
//     await mongoose.connect(MONGODB_URI);
    
//     // Fetch a single appointment, leaning it to get a plain JS object
//     let appointmentDoc = await Appointment.findOne().sort({ createdAt: -1 }).lean();
    
//     if (!appointmentDoc) {
//       console.log("No appointments found in the DB. Using a mock appointment for demonstration...\n");
//       appointmentDoc = {
//         _id: "mock_id_123",
//         appointmentTime: "10:00 PM",
//         participantsConnectedAt: new Date("2026-08-18T21:50:00.000Z"),
//         sessionStartedAt: new Date("2026-08-18T21:50:00.000Z"),
//         scheduledEndAt: new Date("2026-08-18T22:40:00.000Z")
//       };
//     }

//     console.log("--- Consultation Timing Overview ---");
//     console.log("Appointment ID:", appointmentDoc._id.toString());
//     console.log("Appointment Time:", appointmentDoc.appointmentTime || "N/A");
    
//     console.log("Participants Connected At:", formatTimeOnly(appointmentDoc.participantsConnectedAt));
//     console.log("Session Started At:", formatTimeOnly(appointmentDoc.sessionStartedAt));
//     console.log("Exact End Time:", formatTimeOnly(appointmentDoc.scheduledEndAt));
//   } catch (error) {
//     console.error("Error connecting to MongoDB or fetching data:", error);
//   } finally {
//     await mongoose.disconnect();
//   }
// }

// run();





// const date = new Date("2026-08-18T06:50:42.243+00:00");

// const formatted = date.toLocaleString("en-IN", {
//   day: "2-digit",
//   month: "2-digit",
//   year: "numeric",
//   hour: "2-digit",
//   minute: "2-digit",
//   second: "2-digit",
//   hour12: true,
// });

// console.log(formatted);



const date = new Date("2026-08-19T04:01:13.685+00:00");

const time = date.toLocaleTimeString("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
});

console.log("_____________________");
console.log("_____________________");
console.log("__________________")

console.log(time);

console.log("_____________________");
console.log("_____________________");
console.log("_____________________");
