// src/infrastructure/database/models/MedicalRecord.js

import mongoose from "mongoose";

const medicalRecordSchema = new mongoose.Schema({
    patientId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User',
        required: true 
    },
    title: { 
        type: String, 
        required: true, 
        trim: true 
    },
    category: { 
        type: String, 
        enum: ["Lab Results", "Imaging", "Prescription", "Discharge Summary", "Other"],
        default: "Other" 
    },
    fileUrl: { 
        type: String, 
        required: true 
    },
    date: { 
        type: Date, 
        default: Date.now 
    },
    notes: {
        type: String,
        trim: true
    }
}, { timestamps: true });

export default mongoose.model("MedicalRecord", medicalRecordSchema);
