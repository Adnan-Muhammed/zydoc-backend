export class CreatePaymentOrder {
  constructor(paymentService, appointmentRepository) {
    this.paymentService = paymentService;
    this.appointmentRepository = appointmentRepository;
  }

  async execute(appointmentId, currentUserId) {
    // 2. Fetch the appointment
    const appointment = await this.appointmentRepository.findById(appointmentId);
    if (!appointment) throw new Error('Appointment not found');

    // Helper to safely check status regardless of casing in DB
    const status = appointment.status?.toLowerCase();
    
    // 3. Exact authorization bypass
    const isAvailable = status === 'available';
    const isLockedByCurrentUser = status === 'locked' && appointment.lockedBy?.toString() === currentUserId.toString();

    if (!(isAvailable || isLockedByCurrentUser)) {
      // 4. If it fails the check, throw error
      throw new Error('Unfortunately, this slot was just locked by another user.');
    }

    const totalAmount = appointment.fee || 0;
    if (totalAmount <= 0) throw new Error('Invalid total amount for payment');

    const amountInPaise = Math.round(totalAmount * 100);
    
    // 5. Call PaymentService.createOrder
    const order = await this.paymentService.createOrder(amountInPaise, appointmentId.toString());

    // 6. Update the appointment with status, lockedBy, and orderId (using razorpayOrderId to match our schema)
    appointment.status = 'locked';
    appointment.lockedBy = currentUserId;
    appointment.razorpayOrderId = order.id;
    await this.appointmentRepository.update(appointmentId, appointment);

    // 7. Return { orderId, amount, currency }
    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency
    };
  }
}
 