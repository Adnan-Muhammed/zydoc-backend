import { CreatePaymentOrder } from "../../application/usecases/payment/CreatePaymentOrder.js";
import { VerifyPayment } from "../../application/usecases/payment/VerifyPayment.js";
import PaymentService from "../../infrastructure/services/PaymentService.js";
import { MongoAppointmentRepository } from "../../infrastructure/repositories/MongoAppointmentRepository.js";
import { MongoTransactionRepository } from "../../infrastructure/repositories/MongoTransactionRepository.js";
import { MailService } from "../../infrastructure/security/MailService.js";

const appointmentRepo = new MongoAppointmentRepository();
const transactionRepo = new MongoTransactionRepository();
const mailService = new MailService();
const createPaymentOrderUseCase = new CreatePaymentOrder(PaymentService, appointmentRepo);
const verifyPaymentUseCase = new VerifyPayment(PaymentService, appointmentRepo, transactionRepo, mailService);

export const createRazorpayOrder = async (req, res) => {
  try {
    const { appointmentId } = req.body;
    const currentUserId = req.user?.id || req.user?._id;

    if (!appointmentId) return res.status(400).json({ success: false, message: 'appointmentId is required' });
    if (!currentUserId) return res.status(401).json({ success: false, message: 'Unauthorized. User ID not found.' });

    const orderDetails = await createPaymentOrderUseCase.execute(appointmentId, currentUserId);

    // Return the response structured exactly as the frontend expects from `appointmentService.createRazorpayOrder`
    // Returning properties at root level so `res.data.id` maps properly.
    return res.status(200).json({
      success: true,
      message: 'Payment order created successfully',
      id: orderDetails.orderId,
      amount: orderDetails.amount,
      currency: orderDetails.currency
    });
  } catch (error) {
    console.error('PaymentController.createRazorpayOrder Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Missing parameters' });
    }

    const verificationResult = await verifyPaymentUseCase.execute(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    return res.status(200).json({
      success: true,
      message: 'Payment verified and appointment scheduled successfully'
    });
  } catch (error) {
    console.error('PaymentController.verifyPayment Error:', error);
    return res.status(400).json({ success: false, message: error.message });
  }
};
