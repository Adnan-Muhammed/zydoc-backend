
// // src/infrastructure/database/models/PatientProfile.js

// import mongoose from "mongoose";

// const patientSchema = new mongoose.Schema({
//     name: { type: String, required: true },
//     dateOfBirth: { type: Date },
//     medicalHistory: [{ type: String }],
//     emergencyContact: { type: String }
// }, { timestamps: true });

// export default mongoose.model("Patient", patientSchema);

// src/infrastructure/database/models/PatientProfile.js
import mongoose from "mongoose";

const patientSchema = new mongoose.Schema({
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true, default: "" },
    phone: { type: String, trim: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: ["male", "female", "other"] },
    bloodGroup: { type: String, enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
    avatarUrl: { type: String, default: "" },
    fcmToken: { type: String },

    emergencyContact: {
        name: { type: String, trim: true },
        relationship: { type: String, trim: true },
        phone: { type: String, trim: true }
    },

    address: {
        street: { type: String, trim: true },
        city: { type: String, trim: true },
        state: { type: String, trim: true },
        zipCode: { type: String, trim: true },
        country: { type: String, trim: true }
    },

    // Baseline health logs for consult context reference
    medicalHistory: {
        allergies: [{ type: String }],
        chronicConditions: [{ type: String }],
        currentMedications: [{ type: String }]
    }
}, { timestamps: true });

export default mongoose.model("Patient", patientSchema);