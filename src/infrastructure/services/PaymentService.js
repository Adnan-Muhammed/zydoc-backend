import Razorpay from 'razorpay';
import crypto from 'crypto';
import { razorpayRefund, verifyRazorpaySignature } from './RazorpayService.js';

class PaymentService {
  constructor() {
    this.razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }

  async createOrder(amount, receiptId) {
    const options = {
      amount: amount,
      currency: 'INR',
      receipt: receiptId,
    };
    try {
      return await this.razorpay.orders.create(options);
    } catch (error) {
      console.error('Error creating Razorpay order:', error);
      throw error;
    }
  }

  async refundPayment(paymentId, amount, options = {}) {
    return await razorpayRefund(paymentId, amount, options);
  }

  verifySignature(orderId, paymentId, signature) {
    return verifyRazorpaySignature(orderId, paymentId, signature);
  }
}

export { razorpayRefund, verifyRazorpaySignature };
export default new PaymentService();