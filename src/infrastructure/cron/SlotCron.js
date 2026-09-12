import cron from "node-cron";
import { MongoAppointmentRepository } from "../repositories/MongoAppointmentRepository.js";

const appointmentRepo = new MongoAppointmentRepository();

// Run every minute
// slot expiry cron job is commented slot expiry automatically happen on slot time out 
// 
cron.schedule('* * * * *', async () => {
    try {
        const now = new Date();
        const expiredLocks = await appointmentRepo.findExpiredLocks(now);
        
        for (const appointment of expiredLocks) {
            // Mark as 'expired' instead of deleting.
            // This preserves the razorpayOrderId so VerifyPayment can find
            // the record and issue a refund if Razorpay captured the payment
            // after the lock TTL elapsed.
            await appointmentRepo.expireLockedSlot(appointment._id);
        }
    } catch (error) { 
        console.error("Error in SlotCron:", error);
    }
});

// console.log("Slot expiration cron job initialized.");
// slot expiry cron job is commented slot expiry automatically happen on slot time out 
