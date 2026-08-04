import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    adminCommission: { type: Number, required: true },
    doctorAmount: { type: Number, required: true },
    paymentId: { type: String, required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'pending' },
}, { timestamps: true });

// Performance indexes
transactionSchema.index({ appointmentId: 1 });
transactionSchema.index({ doctorId: 1 });
transactionSchema.index({ paymentId: 1 });
transactionSchema.index({ status: 1 });

export default mongoose.model("Transaction", transactionSchema);
