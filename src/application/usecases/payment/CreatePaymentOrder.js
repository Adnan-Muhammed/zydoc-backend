export class CreatePaymentOrder {
  constructor(
    paymentService,
    appointmentRepository,
    walletRepository = null,
    debitWalletUseCase = null,
    transactionRepository = null,
    socketService = null,
    mailService = null
  ) {
    this.paymentService = paymentService;
    this.appointmentRepository = appointmentRepository;
    this.walletRepository = walletRepository;
    this.debitWalletUseCase = debitWalletUseCase;
    this.transactionRepository = transactionRepository;
    this.socketService = socketService;
    this.mailService = mailService;
  }

  async execute(appointmentId, currentUserId, useWallet = false) {
    // 1. Fetch the appointment
    const appointment = await this.appointmentRepository.findById(appointmentId);
    if (!appointment) throw new Error('Appointment not found');

    // Helper to safely check status regardless of casing in DB
    const status = appointment.status?.toLowerCase();

    // 2. Authorization / availability check
    const isAvailable = status === 'available';
    const isLockedByCurrentUser =
      status === 'locked' && appointment.lockedBy?.toString() === currentUserId.toString();

    if (!(isAvailable || isLockedByCurrentUser)) {
      throw new Error('Unfortunately, this slot was just locked by another user.');
    }

    const slotFee = appointment.fee || 0;
    if (slotFee <= 0) throw new Error('Invalid total amount for payment');

    // 3. Fetch patient's wallet balance if requested
    let walletBalance = 0;
    if (useWallet && this.walletRepository) {
      try {
        walletBalance = await this.walletRepository.getBalance(currentUserId);
      } catch (err) {
        console.error('[CreatePaymentOrder] Error fetching wallet balance:', err);
        walletBalance = 0;
      }
    }

    // 4. Scenario A: FULL_WALLET (Wallet covers entire consultation fee)
    if (useWallet && walletBalance >= slotFee) {
      if (!this.debitWalletUseCase) {
        throw new Error('DebitWalletUseCase not configured');
      }

      // Directly debit the wallet for slotFee
      await this.debitWalletUseCase.execute({
        patientId: currentUserId,
        amount: slotFee,
        description: `Consultation payment for appointment on ${new Date(
          appointment.appointmentDate
        ).toDateString()} at ${appointment.appointmentTime}`,
        appointmentId: appointment._id,
      });

      // Calculate commission rates
      let commissionRate = 0.10; // 10% online
      if (['physical', 'offline'].includes(appointment.consultationType)) {
        commissionRate = 0.05; // 5% offline
      }
      const calculatedAdminCommission = slotFee * commissionRate;
      const calculatedDoctorAmount = slotFee - calculatedAdminCommission;

      appointment.status = 'scheduled';
      appointment.lockedBy = currentUserId;
      appointment.patientId = currentUserId;
      appointment.paymentStatus = 'paid';
      appointment.paymentMethod = 'FULL_WALLET';
      appointment.feeBreakdown = {
        totalFee: slotFee,
        walletDeducted: slotFee,
        onlinePaid: 0,
      };
      appointment.adminCommission = calculatedAdminCommission;
      appointment.doctorAmount = calculatedDoctorAmount;
      appointment.paymentId = `WALLET_${appointment._id}_${Date.now()}`;

      // Generate Offline OTP if in-person consultation
      if (['offline', 'physical'].includes(appointment.consultationType)) {
        appointment.offlineOTP = (Math.floor(Math.random() * 9000) + 1000).toString();
      }

      await appointment.save();

      // Record platform transaction
      if (this.transactionRepository) {
        try {
          await this.transactionRepository.create({
            appointmentId: appointment._id,
            doctorId: appointment.doctorId,
            patientId: currentUserId,
            amount: slotFee,
            adminCommission: calculatedAdminCommission,
            doctorAmount: calculatedDoctorAmount,
            paymentId: appointment.paymentId,
            status: 'pending',
          });
        } catch (txErr) {
          console.error('[CreatePaymentOrder] Error creating transaction record:', txErr);
        }
      }

      // Real-time booking notification to doctor
      if (this.socketService && typeof this.socketService.emitNewBookingNotification === 'function') {
        try {
          let recipientId = appointment.doctorId;
          const mongoose = (await import('mongoose')).default || await import('mongoose');
          const SharedUser = mongoose.model('SharedUser');
          const doctorUser = await SharedUser.findOne({ profileId: appointment.doctorId, role: 'doctor' });
          if (doctorUser) {
            recipientId = doctorUser._id;
          }
          this.socketService.emitNewBookingNotification(recipientId, appointment);
        } catch (sockErr) {
          console.error('[CreatePaymentOrder] Error emitting booking notification:', sockErr);
        }
      }

      return {
        status: 'COMPLETED_VIA_WALLET',
        appointmentId: appointment._id,
      };
    }

    // 5. Scenario B: SPLIT Payment (Wallet partially covers consultation fee)
    if (useWallet && walletBalance > 0 && walletBalance < slotFee) {
      const remainingOnline = slotFee - walletBalance;
      const amountInPaise = Math.round(remainingOnline * 100);

      const order = await this.paymentService.createOrder(amountInPaise, appointmentId.toString());

      // Update appointment with locked status, split payment method & pending breakdown
      // Note: Wallet balance is NOT deducted here; it will be debited inside VerifyPayment upon signature validation.
      appointment.status = 'locked';
      appointment.lockedBy = currentUserId;
      appointment.patientId = currentUserId;
      appointment.razorpayOrderId = order.id;
      appointment.paymentMethod = 'SPLIT';
      appointment.feeBreakdown = {
        totalFee: slotFee,
        walletDeducted: walletBalance,
        onlinePaid: remainingOnline,
      };

      await appointment.save();

      return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        splitPayment: true,
        walletDeducted: walletBalance,
        onlinePayable: remainingOnline,
      };
    }

    // 6. Scenario C: FULL_ONLINE (Standard full Razorpay payment)
    const amountInPaise = Math.round(slotFee * 100);
    const order = await this.paymentService.createOrder(amountInPaise, appointmentId.toString());

    appointment.status = 'locked';
    appointment.lockedBy = currentUserId;
    appointment.patientId = currentUserId;
    appointment.razorpayOrderId = order.id;
    appointment.paymentMethod = 'FULL_ONLINE';
    appointment.feeBreakdown = {
      totalFee: slotFee,
      walletDeducted: 0,
      onlinePaid: slotFee,
    };

    await appointment.save();

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      splitPayment: false,
      walletDeducted: 0,
      onlinePayable: slotFee,
    };
  }
}