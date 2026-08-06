import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema({
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'SharedUser', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    appointmentDate: { type: Date, required: true },
    appointmentTime: { type: String, required: true },
    consultationType: { type: String, enum: ['video', 'physical', 'online', 'offline'], required: true },
    status: { type: String, enum: ['available', 'locked', 'scheduled', 'completed', 'cancelled'], default: 'scheduled' },
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'SharedUser' },
    lockExpiryTime: { type: Date },
    paymentId: { type: String }, 
    razorpayOrderId: { type: String },
    adminCommission: { type: Number },
    doctorAmount: { type: Number },
    fee: { type: Number, required: true },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
    notes: { type: String, trim: true }
}, { timestamps: true });

// Performance indexes
appointmentSchema.index({ patientId: 1 });
appointmentSchema.index({ doctorId: 1 });
appointmentSchema.index({ appointmentDate: 1 });
appointmentSchema.index({ status: 1 });

export default mongoose.model("Appointment", appointmentSchema);
