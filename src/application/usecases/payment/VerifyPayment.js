export class VerifyPayment {
  constructor(paymentService, appointmentRepository) {
    this.paymentService = paymentService;
    this.appointmentRepository = appointmentRepository;
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
    await this.appointmentRepository.update(appointment._id, appointment);

    return { success: true, appointment };
  }
}
