// tests/email-service-centralization.test.js

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EmailService, EMAIL_FEATURES } from '../src/infrastructure/services/EmailService.js';
import { MailService } from '../src/infrastructure/security/MailService.js';

describe('Centralized EmailService and Feature Flags Audit Verification', () => {
  let mockTransporter;
  let sentMails;
  let emailServiceInstance;

  beforeEach(() => {
    sentMails = [];
    mockTransporter = {
      sendMail: async (options) => {
        sentMails.push(options);
        return { messageId: 'mock-msg-' + Date.now() };
      },
    };
    emailServiceInstance = new EmailService(mockTransporter);

    // Reset default flags to disabled
    EMAIL_FEATURES.PATIENT_BOOKING_CONFIRMATION = false;
    EMAIL_FEATURES.DOCTOR_BOOKING_NOTIFICATION = false;
    EMAIL_FEATURES.SIGNUP_OTP = false;
    EMAIL_FEATURES.RESEND_OTP = false;
    EMAIL_FEATURES.LOGIN_RESCUE_OTP = false;
    EMAIL_FEATURES.FORGOT_PASSWORD_OTP = false;
    EMAIL_FEATURES.REFUND_APPROVED = false;
    EMAIL_FEATURES.REFUND_REJECTED = false;
    EMAIL_FEATURES.DOCTOR_APPLICATION_APPROVED = false;
    EMAIL_FEATURES.DOCTOR_APPLICATION_REJECTED = false;
  });

  it('1. All features default to disabled (preserving commented-out state)', () => {
    assert.strictEqual(EMAIL_FEATURES.PATIENT_BOOKING_CONFIRMATION, false);
    assert.strictEqual(EMAIL_FEATURES.DOCTOR_BOOKING_NOTIFICATION, false);
    assert.strictEqual(EMAIL_FEATURES.SIGNUP_OTP, false);
    assert.strictEqual(EMAIL_FEATURES.RESEND_OTP, false);
    assert.strictEqual(EMAIL_FEATURES.LOGIN_RESCUE_OTP, false);
    assert.strictEqual(EMAIL_FEATURES.FORGOT_PASSWORD_OTP, false);
    assert.strictEqual(EMAIL_FEATURES.REFUND_APPROVED, false);
    assert.strictEqual(EMAIL_FEATURES.REFUND_REJECTED, false);
  });

  it('2. Disabled appointment emails do not dispatch emails and return skipped', async () => {
    const bookingDetails = {
      date: 'Mon Oct 12 2026',
      time: '10:00 AM',
      type: 'online',
      patientType: 'NEW',
      fee: 500,
    };

    const result = await emailServiceInstance.sendBookingConfirmation({
      patientEmail: 'patient@example.com',
      doctorEmail: 'doctor@example.com',
      patientName: 'John Patient',
      doctorName: 'Jane Doctor',
      bookingDetails,
    });

    assert.strictEqual(sentMails.length, 0);
    assert.strictEqual(result.patientResult.skipped, true);
    assert.strictEqual(result.patientResult.reason, 'FEATURE_DISABLED');
    assert.strictEqual(result.doctorResult.skipped, true);
    assert.strictEqual(result.doctorResult.reason, 'FEATURE_DISABLED');
  });

  it('3. Enabled patient appointment email sends without sending doctor email when doctor flag is off', async () => {
    EMAIL_FEATURES.PATIENT_BOOKING_CONFIRMATION = true;
    EMAIL_FEATURES.DOCTOR_BOOKING_NOTIFICATION = false;

    const bookingDetails = {
      date: 'Mon Oct 12 2026',
      time: '10:00 AM',
      type: 'online',
      patientType: 'NEW',
      fee: 500,
    };

    const result = await emailServiceInstance.sendBookingConfirmation({
      patientEmail: 'patient@example.com',
      doctorEmail: 'doctor@example.com',
      patientName: 'John Patient',
      doctorName: 'Jane Doctor',
      bookingDetails,
    });

    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, '"John Patient" <patient@example.com>');
    assert.strictEqual(result.patientResult.success, true);
    assert.strictEqual(result.patientResult.skipped, false);
    assert.strictEqual(result.doctorResult.skipped, true);
  });

  it('4. Enabled doctor appointment email sends without sending patient email when patient flag is off', async () => {
    EMAIL_FEATURES.PATIENT_BOOKING_CONFIRMATION = false;
    EMAIL_FEATURES.DOCTOR_BOOKING_NOTIFICATION = true;

    const bookingDetails = {
      date: 'Mon Oct 12 2026',
      time: '10:00 AM',
      type: 'online',
      patientType: 'NEW',
      fee: 500,
    };

    const result = await emailServiceInstance.sendBookingConfirmation({
      patientEmail: 'patient@example.com',
      doctorEmail: 'doctor@example.com',
      patientName: 'John Patient',
      doctorName: 'Jane Doctor',
      bookingDetails,
    });

    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, '"Jane Doctor" <doctor@example.com>');
    assert.strictEqual(result.patientResult.skipped, true);
    assert.strictEqual(result.doctorResult.success, true);
  });

  it('5. Disabling appointment emails does not affect OTP emails', async () => {
    EMAIL_FEATURES.PATIENT_BOOKING_CONFIRMATION = false;
    EMAIL_FEATURES.DOCTOR_BOOKING_NOTIFICATION = false;
    EMAIL_FEATURES.SIGNUP_OTP = true;

    const otpResult = await emailServiceInstance.sendSignupOtpEmail({
      email: 'user@example.com',
      otp: '123456',
    });

    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'user@example.com');
    assert.ok(sentMails[0].html.includes('123456'));
    assert.strictEqual(otpResult.success, true);
  });

  it('6. Disabling OTP emails does not affect appointment emails', async () => {
    EMAIL_FEATURES.SIGNUP_OTP = false;
    EMAIL_FEATURES.RESEND_OTP = false;
    EMAIL_FEATURES.PATIENT_BOOKING_CONFIRMATION = true;

    const otpResult = await emailServiceInstance.sendSignupOtpEmail({
      email: 'user@example.com',
      otp: '123456',
    });
    assert.strictEqual(otpResult.skipped, true);
    assert.strictEqual(sentMails.length, 0);

    const bookingResult = await emailServiceInstance.sendPatientAppointmentEmail({
      patientEmail: 'patient@example.com',
      patientName: 'Jane Patient',
      doctorName: 'Dr. Smith',
      bookingDetails: { date: '2026-10-15', time: '11:00 AM', fee: 400 },
    });

    assert.strictEqual(bookingResult.success, true);
    assert.strictEqual(sentMails.length, 1);
  });

  it('7. Independent feature flags for resend OTP, login rescue OTP, and forgot password OTP', async () => {
    // Only forgot password enabled
    EMAIL_FEATURES.FORGOT_PASSWORD_OTP = true;

    const resend = await emailServiceInstance.sendResendOtpEmail({ email: 'u@test.com', otp: '1111' });
    const rescue = await emailServiceInstance.sendLoginRescueOtpEmail({ email: 'u@test.com', otp: '2222' });
    const forgot = await emailServiceInstance.sendForgotPasswordOtpEmail({ email: 'u@test.com', otp: '3333' });

    assert.strictEqual(resend.skipped, true);
    assert.strictEqual(rescue.skipped, true);
    assert.strictEqual(forgot.success, true);
    assert.strictEqual(sentMails.length, 1);
    assert.ok(sentMails[0].html.includes('3333'));
  });

  it('8. Refund approval & rejection emails are controlled independently', async () => {
    EMAIL_FEATURES.REFUND_APPROVED = true;
    EMAIL_FEATURES.REFUND_REJECTED = false;

    const approved = await emailServiceInstance.sendRefundApprovedEmail({
      patientEmail: 'refund@patient.com',
      patientName: 'Patient Bob',
      refundAmount: 500,
      ticketId: 'TK-1234',
    });

    const rejected = await emailServiceInstance.sendRefundRejectedEmail({
      patientEmail: 'refund@patient.com',
      patientName: 'Patient Bob',
      ticketId: 'TK-1234',
      reason: 'No show',
    });

    assert.strictEqual(approved.success, true);
    assert.strictEqual(rejected.skipped, true);
    assert.strictEqual(sentMails.length, 1);
    assert.ok(sentMails[0].html.includes('₹500'));
  });

  it('9. Legacy MailService adapter extends and preserves full compatibility', async () => {
    const legacyService = new MailService(mockTransporter);
    EMAIL_FEATURES.SIGNUP_OTP = true;

    const result = await legacyService.sendOtpEmail('legacy@user.com', '654321');
    assert.strictEqual(result.success, true);
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'legacy@user.com');
  });
});
