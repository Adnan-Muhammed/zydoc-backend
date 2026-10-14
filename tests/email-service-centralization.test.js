// tests/email-service-centralization.test.js

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EmailService, EMAIL_FEATURES } from '../src/infrastructure/services/EmailService.js';
import { MailService } from '../src/infrastructure/security/MailService.js';

describe('Centralized EmailService and Feature Flags Audit Verification', () => {
  let mockTransporter;
  let sentMails;
  let emailServiceInstance;
  const adminEmail = 'admin@example.com';

  beforeEach(() => {
    process.env.ADMIN_EMAIL = adminEmail;
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

  it('1. Default email feature flag configurations are present', () => {
    assert.strictEqual(typeof EMAIL_FEATURES.PATIENT_BOOKING_CONFIRMATION, 'boolean');
    assert.strictEqual(typeof EMAIL_FEATURES.DOCTOR_BOOKING_NOTIFICATION, 'boolean');
    assert.strictEqual(typeof EMAIL_FEATURES.SIGNUP_OTP, 'boolean');
    assert.strictEqual(typeof EMAIL_FEATURES.RESEND_OTP, 'boolean');
    assert.strictEqual(typeof EMAIL_FEATURES.LOGIN_RESCUE_OTP, 'boolean');
    assert.strictEqual(typeof EMAIL_FEATURES.FORGOT_PASSWORD_OTP, 'boolean');
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

  it('5. Enabled OTP email sends normally to user actual email, NOT to admin', async () => {
    EMAIL_FEATURES.SIGNUP_OTP = true;

    const otpResult = await emailServiceInstance.sendSignupOtpEmail({
      email: 'user@example.com',
      otp: '123456',
      role: 'patient',
    });

    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'user@example.com');
    assert.ok(sentMails[0].html.includes('123456'));
    assert.strictEqual(otpResult.success, true);
    assert.strictEqual(otpResult.redirectedToAdmin, false);
    assert.strictEqual(otpResult.recipient, 'user@example.com');
  });

  it('6. When OTP config is false, OTP email is NOT sent to user, but redirected directly to Admin', async () => {
    EMAIL_FEATURES.SIGNUP_OTP = false;

    const otpResult = await emailServiceInstance.sendSignupOtpEmail({
      email: 'patient_signup@example.com',
      otp: '889900',
      role: 'patient',
    });

    assert.strictEqual(sentMails.length, 1);
    // Verified: NOT sent to user, but sent to admin
    assert.notStrictEqual(sentMails[0].to, 'patient_signup@example.com');
    assert.strictEqual(sentMails[0].to, adminEmail);

    // Verified: Admin email includes generated OTP, user email, user role, and email type/service name
    assert.ok(sentMails[0].html.includes('889900'), 'Admin email must include generated OTP');
    assert.ok(sentMails[0].html.includes('patient_signup@example.com'), 'Admin email must include User Email');
    assert.ok(sentMails[0].html.includes('Patient'), 'Admin email must include User Role');
    assert.ok(sentMails[0].html.includes('Signup OTP'), 'Admin email must include Service Name');
    assert.ok(sentMails[0].subject.includes('Signup OTP'), 'Subject must mention service name');
    assert.ok(sentMails[0].subject.includes('patient_signup@example.com'), 'Subject must mention user email');

    assert.strictEqual(otpResult.success, true);
    assert.strictEqual(otpResult.redirectedToAdmin, true);
    assert.strictEqual(otpResult.recipient, adminEmail);
  });

  it('7. Independent feature flags for resend OTP, login rescue OTP, and forgot password OTP redirect to Admin when false', async () => {
    // Only forgot password enabled (true); resend & rescue disabled (false)
    EMAIL_FEATURES.FORGOT_PASSWORD_OTP = true;
    EMAIL_FEATURES.RESEND_OTP = false;
    EMAIL_FEATURES.LOGIN_RESCUE_OTP = false;

    const resend = await emailServiceInstance.sendResendOtpEmail({ email: 'doctor@test.com', otp: '111111', role: 'doctor' });
    const rescue = await emailServiceInstance.sendLoginRescueOtpEmail({ email: 'patient@test.com', otp: '222222', role: 'patient' });
    const forgot = await emailServiceInstance.sendForgotPasswordOtpEmail({ email: 'forgot@test.com', otp: '333333', role: 'patient' });

    assert.strictEqual(sentMails.length, 3);

    // Resend (false) -> sent to admin with Doctor role
    assert.strictEqual(resend.redirectedToAdmin, true);
    assert.strictEqual(sentMails[0].to, adminEmail);
    assert.ok(sentMails[0].html.includes('111111'));
    assert.ok(sentMails[0].html.includes('doctor@test.com'));
    assert.ok(sentMails[0].html.includes('Doctor'));
    assert.ok(sentMails[0].html.includes('Resend OTP'));

    // Rescue (false) -> sent to admin with Patient role
    assert.strictEqual(rescue.redirectedToAdmin, true);
    assert.strictEqual(sentMails[1].to, adminEmail);
    assert.ok(sentMails[1].html.includes('222222'));
    assert.ok(sentMails[1].html.includes('patient@test.com'));
    assert.ok(sentMails[1].html.includes('Patient'));
    assert.ok(sentMails[1].html.includes('Login Rescue OTP'));

    // Forgot password (true) -> sent directly to user, not admin
    assert.strictEqual(forgot.redirectedToAdmin, false);
    assert.strictEqual(sentMails[2].to, 'forgot@test.com');
    assert.ok(sentMails[2].html.includes('333333'));
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

  it('9. Legacy MailService adapter extends and preserves full compatibility with conditional OTP redirection', async () => {
    const legacyService = new MailService(mockTransporter);

    // When flag is true
    EMAIL_FEATURES.SIGNUP_OTP = true;
    const resultTrue = await legacyService.sendOtpEmail('legacy@user.com', '654321', 'SIGNUP_OTP', 'patient');
    assert.strictEqual(resultTrue.success, true);
    assert.strictEqual(resultTrue.redirectedToAdmin, false);
    assert.strictEqual(sentMails[0].to, 'legacy@user.com');

    // When flag is false
    EMAIL_FEATURES.SIGNUP_OTP = false;
    const resultFalse = await legacyService.sendOtpEmail('legacy2@user.com', '789012', 'SIGNUP_OTP', 'doctor');
    assert.strictEqual(resultFalse.success, true);
    assert.strictEqual(resultFalse.redirectedToAdmin, true);
    assert.strictEqual(sentMails[1].to, adminEmail);
    assert.ok(sentMails[1].html.includes('789012'));
    assert.ok(sentMails[1].html.includes('legacy2@user.com'));
    assert.ok(sentMails[1].html.includes('Doctor'));
  });
});
