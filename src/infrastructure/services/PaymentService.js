import Razorpay from 'razorpay';
import crypto from 'crypto';

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

  verifySignature(orderId, paymentId, signature) {
    try {
      const body = orderId + '|' + paymentId;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');
      return expectedSignature === signature;
    } catch (error) {
      console.error('Error verifying Razorpay signature:', error);
      return false;
    }
  }
}

export default new PaymentService();
 