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
        // Atomic check failed: slot was probably expired or taken.
        // Trigger automatic refund.
        if (this.paymentService.refundPayment) {
            await this.paymentService.refundPayment(razorpay_payment_id, Math.round(appointment.fee * 100));
        }
        const error = new Error('Slot expired. Payment refunded.');
        error.code = 'SLOT_EXPIRED_REFUNDED';
        throw error;
    }

    appointment = updatedAppointment; // use the updated data for subsequent operations

    if (this.transactionRepository) {
      await this.transactionRepository.create({
        appointmentId: appointment._id,
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        amount: appointment.fee,
        adminCommission: calculatedAdminCommission,
        doctorAmount: calculatedDoctorAmount,
        paymentId: razorpay_payment_id,
        status: 'completed'
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
                    console.log(`[VerifyPayment] Urgent conflict detected for Doctor ${appointment.doctorId}! Emitting urgent-slot-booked.`);
                    this.socketService.emitToUser(appointment.doctorId.toString(), "urgent-slot-booked", {
                        appointmentId: appointment._id
                    });
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
      // console.log("[VerifyPayment] socketService is available, emitting new booking notification...");
      //  real time booking notification service console log is commented
      try {
        this.socketService.emitNewBookingNotification(appointment.doctorId, appointment);
      } catch (error) {
        console.error("[VerifyPayment] Error emitting new booking notification:", error);
      }
    } else {
      console.log("[VerifyPayment] socketService or emitNewBookingNotification method is NOT available on this instance.");
    }

    return { success: true, appointment };
  }
}

