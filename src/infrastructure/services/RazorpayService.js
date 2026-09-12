import Razorpay from 'razorpay';
import crypto from 'crypto';

/**
 * Centralized Razorpay instance
 */
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/**
 * Centralized Razorpay refund utility function.
 *
 * @param {string} paymentId - The Razorpay payment ID (e.g., 'pay_xxx')
 * @param {number|string} [amount] - The amount to refund in INR (Rupees) or paise.
 *                                   If not provided or null, a full refund is issued.
 * @param {object} [options] - Additional Razorpay refund options (notes, speed, etc.)
 * @returns {Promise<object>} - The Razorpay refund entity response.
 */
export async function razorpayRefund(paymentId, amount, options = {}) {
  if (!paymentId) {
    throw new Error('Payment ID is required to process a refund.');
  }

  const refundPayload = { ...options };

  // Razorpay expects amount in paise (1 INR = 100 paise)
  if (amount !== undefined && amount !== null && !isNaN(Number(amount))) {
    const numAmount = Number(amount);
    // If amount is small or equal to appointment fee (standard INR), convert to paise.
    // If it's already in paise (e.g. > 100000), keep as integer paise.
    const amountInPaise = numAmount > 100000 ? Math.round(numAmount) : Math.round(numAmount * 100);
    refundPayload.amount = amountInPaise;
  }

  try {
    console.log(`[razorpayRefund] Initiating refund for paymentId: ${paymentId}`, refundPayload);
    const refund = await razorpay.payments.refund(paymentId, refundPayload);
    console.log(`[razorpayRefund] Refund successful for paymentId: ${paymentId}, refundId: ${refund.id}`);
    return refund;
  } catch (error) {
    console.error(`[razorpayRefund] Error processing refund for ${paymentId}:`, error);

    // If already refunded in Razorpay, handle gracefully
    if (
      error.error?.description?.toLowerCase().includes('already been refunded') ||
      error.description?.toLowerCase().includes('already been refunded')
    ) {
      console.warn(`[razorpayRefund] Payment ${paymentId} was already refunded in Razorpay.`);
      return {
        id: `rfnd_already_${Date.now()}`,
        status: 'processed',
        payment_id: paymentId,
        already_refunded: true,
      };
    }

    // In local development or testing with mock IDs:
    if (
      process.env.NODE_ENV === 'development' &&
      (paymentId.startsWith('mock_') || paymentId.startsWith('test_') || error.statusCode === 400)
    ) {
      console.warn(`[razorpayRefund] Development fallback: returning mock refund entity for ${paymentId}`);
      return {
        id: `rfnd_mock_${Date.now()}`,
        entity: 'refund',
        amount: refundPayload.amount || 0,
        currency: 'INR',
        payment_id: paymentId,
        status: 'processed',
        speed_processed: 'normal',
        created_at: Math.floor(Date.now() / 1000),
      };
    }

    throw error;
  }
}

/**
 * Verify Razorpay HMAC signature
 */
export function verifyRazorpaySignature(orderId, paymentId, signature) {
  try {
    const body = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');
    return expectedSignature === signature;
  } catch (error) {
    console.error('[verifyRazorpaySignature] Error verifying signature:', error);
    return false;
  }
}

export default {
  razorpay,
  razorpayRefund,
  verifyRazorpaySignature,
};
