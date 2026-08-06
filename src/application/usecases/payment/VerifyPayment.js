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

    const appointment = await this.appointmentRepository.findByOrderId(razorpay_order_id);
    if (!appointment) throw new Error('Appointment not found for this order');

    appointment.status = 'scheduled';
    appointment.paymentId = razorpay_payment_id;
    appointment.paymentStatus = 'paid';

    let commissionRate = 0;
    if (['video', 'online'].includes(appointment.consultationType)) {
        commissionRate = 0.10; // 10% for online
    } else if (['physical', 'offline'].includes(appointment.consultationType)) {
        commissionRate = 0.05; // 5% for offline
    }
    const calculatedAdminCommission = appointment.fee * commissionRate;
    const calculatedDoctorAmount = appointment.fee - calculatedAdminCommission;
    
    appointment.adminCommission = calculatedAdminCommission;
    appointment.doctorAmount = calculatedDoctorAmount;

    await this.appointmentRepository.update(appointment._id, appointment);

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

    // Trigger booking confirmation email asynchronously without blocking the response
    if (this.mailService && typeof this.mailService.sendBookingConfirmation === 'function') {
      console.log("[VerifyPayment] mailService is available, fetching booking details...");
      this.appointmentRepository.getBookingDetailsForEmail(appointment._id)
        .then(bookingInfo => {
          console.log("[VerifyPayment] Fetched bookingInfo:", bookingInfo);
          if (bookingInfo && bookingInfo.patientEmail && bookingInfo.doctorEmail) {
            console.log("[VerifyPayment] Invoking sendBookingConfirmation...");
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
      console.log("[VerifyPayment] socketService is available, emitting new booking notification...");
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
