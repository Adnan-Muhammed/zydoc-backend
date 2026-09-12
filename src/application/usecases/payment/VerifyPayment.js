export class VerifyPayment {
  constructor(paymentService, appointmentRepository, transactionRepository, mailService, socketService) {
    this.paymentService = paymentService;
    this.appointmentRepository = appointmentRepository;
    this.transactionRepository = transactionRepository;
    this.mailService = mailService;
    this.socketService = socketService;
  }

  async execute(razorpay_order_id, razorpay_payment_id, razorpay_signature) {
    const isValid = this.paymentService.verifySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) throw new Error('Invalid payment signature');

    let appointment = await this.appointmentRepository.findByOrderId(razorpay_order_id);
    if (!appointment) throw new Error('Appointment not found for this order');

    // ── Idempotency Guard ──────────────────────────────────────────────────────
    // A race between the frontend redirect and the Razorpay webhook can cause
    // two concurrent calls for the same successful payment. The second caller
    // will see the slot is no longer in a "locked" state and, without this
    // guard, would fall through to confirmBooking → null → refund.
    // If the appointment is already scheduled/paid for this exact payment, we
    // simply return success without touching the database again.
    const alreadyProcessed =
      (appointment.status === 'scheduled' || appointment.paymentStatus === 'paid') &&
      appointment.paymentStatus !== 'direct' && // 'direct' = doctor-collected, never via this flow
      (appointment.paymentId === razorpay_payment_id ||
        appointment.orderId === razorpay_order_id);

    if (alreadyProcessed) {
      console.log(
        `[VerifyPayment] Idempotency hit: appointment ${appointment._id} is already ` +
        `${appointment.status}/${appointment.paymentStatus}. Returning cached success.`
      );
      return { success: true, appointment };
    }
    // ───────────────────────────────────────────────────────────────────────────

    // ── Expired-Lock Guard ────────────────────────────────────────────────────
    // If the cron already marked this lock as 'expired' (TTL elapsed) but
    // Razorpay still captured the payment, we must refund immediately.
    // Checking here — before confirmBooking — gives us a clean error path and
    // avoids the ambiguous "confirmBooking returned null" branch below.
    if (appointment.status === 'expired') {
        console.warn(`[VerifyPayment] Appointment ${appointment._id} lock expired before payment was verified. Triggering refund.`);
        if (this.paymentService.refundPayment) {
            await this.paymentService.refundPayment(razorpay_payment_id, Math.round(appointment.fee * 100));
        }
        const error = new Error('Slot lock expired. Payment refunded.');
        error.code = 'SLOT_EXPIRED_REFUNDED';
        throw error;
    }
    // ─────────────────────────────────────────────────────────────────────────

    let commissionRate = 0;
    if (['video', 'online'].includes(appointment.consultationType)) {
        commissionRate = 0.10; // 10% for online
    } else if (['physical', 'offline'].includes(appointment.consultationType)) {
        commissionRate = 0.05; // 5% for offline
    }
    const calculatedAdminCommission = appointment.fee * commissionRate;
    const calculatedDoctorAmount = appointment.fee - calculatedAdminCommission;
    
    const atomicUpdateData = {
        paymentId: razorpay_payment_id,
        paymentStatus: 'paid',
        adminCommission: calculatedAdminCommission,
        doctorAmount: calculatedDoctorAmount
    };

    // Attempt atomic update to lock in the booking
    const updatedAppointment = await this.appointmentRepository.confirmBooking(appointment._id, appointment.lockedBy, atomicUpdateData);

    if (!updatedAppointment) {
        // Atomic check failed: slot was taken by a concurrent request.
        // Trigger automatic refund.
        if (this.paymentService.refundPayment) {
            await this.paymentService.refundPayment(razorpay_payment_id, Math.round(appointment.fee * 100));
        }
        const error = new Error('Slot expired. Payment refunded.');
        error.code = 'SLOT_EXPIRED_REFUNDED';
        throw error;
    }

    appointment = updatedAppointment; // use the updated data for subsequent operations

    // ── Generate Offline OTP (in-person verification code) ─────────────────────
    if (['offline', 'physical'].includes(appointment.consultationType)) {
      try {
        // Generate a guaranteed 4-digit OTP (1000–9999)
        const otp = (Math.floor(Math.random() * 9000) + 1000).toString();
        await import('mongoose').then(async (mongoose) => {
          const Appointment = mongoose.model('Appointment');
          await Appointment.findByIdAndUpdate(appointment._id, { offlineOTP: otp });
        });
        console.log(`[VerifyPayment] OTP generated for offline appointment ${appointment._id}.`);
      } catch (otpErr) {
        // Non-blocking: log and continue. The doctor can still mark no-show via cron.
        console.error(`[VerifyPayment] Failed to generate OTP for appointment ${appointment._id}:`, otpErr);
      }
    }
    // ───────────────────────────────────────────────────────────────────────────────────

    if (this.transactionRepository) {
      await this.transactionRepository.create({
        appointmentId: appointment._id,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        amount: appointment.fee,
        adminCommission: calculatedAdminCommission,
        doctorAmount: calculatedDoctorAmount,
        paymentId: razorpay_payment_id,
        status: 'pending'
      });
    }

    // ── Scenario 3 Conflict Detection ──────────────────────────────────────────
    // Check if this newly booked slot overlaps with "now", meaning the doctor 
    // might be in an active session extending into this time.
    try {
        const now = new Date();
        const [timeStr, modifier] = (appointment.appointmentTime || "").trim().split(/\s+/);
        if (timeStr) {
            let [hours, minutes] = timeStr.split(":");
            let h = parseInt(hours, 10);
            const m = parseInt(minutes, 10) || 0;
            
            if (modifier) {
                if (modifier.toUpperCase() === "PM" && h < 12) h += 12;
                if (modifier.toUpperCase() === "AM" && h === 12) h = 0;
            }
            
            // Assume the slot is for today to check if it's an immediate booking
            const slotLocal = new Date(
                now.getFullYear(), now.getMonth(), now.getDate(),
                h, m, 0, 0
            );

            // If the slot starts within 5 mins, or started within the last 45 mins
            const diffMinutes = (slotLocal.getTime() - now.getTime()) / 60000;
            
            if (diffMinutes <= 5 && diffMinutes >= -45) {
                if (this.socketService && typeof this.socketService.emitToUser === 'function') {
                    try {
                        const mongoose = await import('mongoose');
                        const SharedUser = mongoose.model('SharedUser');
                        const doctorUser = await SharedUser.findOne({ profileId: appointment.doctorId, role: 'doctor' });
                        if (doctorUser) {
                            console.log(`[VerifyPayment] Urgent conflict detected for Doctor SharedUser ${doctorUser._id}! Emitting urgent-slot-booked.`);
                            this.socketService.emitToUser(doctorUser._id.toString(), "urgent-slot-booked", {
                                appointmentId: appointment._id
                            });
                        }
                    } catch (e) {
                        console.error("[VerifyPayment] Error resolving doctor SharedUser for urgent-slot-booked:", e);
                    }
                }
            }
        }
    } catch (err) {
        console.error("[VerifyPayment] Error in conflict detection logic:", err);
    }
    // ───────────────────────────────────────────────────────────────────────────

    // Trigger booking confirmation email asynchronously without blocking the response
    if (this.mailService && typeof this.mailService.sendBookingConfirmation === 'function') {
      // console.log("[VerifyPayment] mailService is available, fetching booking details...");
      //  payment-booking-confirmation mail service  is commented
      this.appointmentRepository.getBookingDetailsForEmail(appointment._id)
        .then(bookingInfo => {
          // console.log("[VerifyPayment] Fetched bookingInfo:", bookingInfo);
          //  payment-booking-confirmation mail service  is commented
          if (bookingInfo && bookingInfo.patientEmail && bookingInfo.doctorEmail) {
            // console.log("[VerifyPayment] Invoking sendBookingConfirmation...");
            //  payment-booking-confirmation mail service  is commented
            return this.mailService.sendBookingConfirmation(bookingInfo);
          } else {
            console.log("[VerifyPayment] Skipped sending email due to missing patientEmail or doctorEmail. Info:", bookingInfo);
          }
        })
        .catch(error => console.error("[VerifyPayment] Error triggering booking confirmation email:", error));
    } else {
      console.log("[VerifyPayment] mailService or sendBookingConfirmation method is NOT available on this instance:", this.mailService);
    }

    // Trigger real-time booking notification
    if (this.socketService && typeof this.socketService.emitNewBookingNotification === 'function') {
      try {
        let recipientId = appointment.doctorId;
        try {
          const mongoose = (await import('mongoose')).default || await import('mongoose');
          const SharedUser = mongoose.model('SharedUser');
          const doctorUser = await SharedUser.findOne({ profileId: appointment.doctorId, role: 'doctor' });
          if (doctorUser) {
            recipientId = doctorUser._id;
          }
        } catch (resolveErr) {
          console.error("[VerifyPayment] Error resolving doctor SharedUser for new booking notification:", resolveErr);
        }
        this.socketService.emitNewBookingNotification(recipientId, appointment);
      } catch (error) {
        console.error("[VerifyPayment] Error emitting new booking notification:", error);
      }
    } else {
      console.log("[VerifyPayment] socketService or emitNewBookingNotification method is NOT available on this instance.");
    }

    return { success: true, appointment };
  }
}

