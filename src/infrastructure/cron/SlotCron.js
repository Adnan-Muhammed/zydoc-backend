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
            await appointmentRepo.unlockSlot(appointment._id, appointment.lockedBy);
           // console.log(`Unlocked expired appointment slot: ${appointment._id}`);
           // slot expiry cron
        }
    } catch (error) { 
        console.error("Error in SlotCron:", error);
    }
});

// console.log("Slot expiration cron job initialized.");
// slot expiry cron job is commented slot expiry automatically happen on slot time out 
