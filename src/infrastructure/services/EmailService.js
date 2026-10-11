// src/infrastructure/services/EmailService.js

import nodemailer from 'nodemailer';

/**
 * ============================================================================
 * CENTRALIZED EMAIL FEATURE FLAGS
 * ============================================================================
 * Toggle any email feature on (true) or off (false) independently.
 * Default values strictly preserve the existing disabled/commented state
 * discovered during the codebase audit.
 * ============================================================================
 */
export const EMAIL_FEATURES = {
  // Appointment notifications
  PATIENT_BOOKING_CONFIRMATION: true,
  DOCTOR_BOOKING_NOTIFICATION: true,

  // Authentication & OTP notifications
  SIGNUP_OTP: true,
  RESEND_OTP: true,
  LOGIN_RESCUE_OTP: true,
  FORGOT_PASSWORD_OTP: true,

  // Admin action notifications
  REFUND_APPROVED: false,
  REFUND_REJECTED: false,
  DOCTOR_APPLICATION_APPROVED: false,
  DOCTOR_APPLICATION_REJECTED: false,
};

export class EmailService {
  constructor(customTransporter = null) {
    this._customTransporter = customTransporter;
    this._transporter = null;
  }

  /**
   * Lazily initializes and returns the nodemailer transporter.
   * Prevents crash on startup when SMTP environment variables are unconfigured.
   */
  getTransporter() {
    if (this._customTransporter) {
      return this._customTransporter;
    }

    if (!this._transporter) {
      const port = Number(process.env.EMAIL_PORT) || 587;
      const isSecure = port === 465;

      this._transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port,
        secure: isSecure,
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });
    }

    return this._transporter;
  }

  /**
   * Helper to resolve the default sender address safely without exposing secrets.
   */
  getSenderAddress() {
    const user = process.env.EMAIL_USER || 'no-reply@zydoc.com';
    return `"ZyDoc Consulting" <${user}>`;
  }

  /**
   * Dispatches an email using the transporter if the given feature flag is active.
   * @private
   */
  async _dispatchEmail({ featureKey, mailOptions, logContext = 'Email' }) {
    if (!EMAIL_FEATURES[featureKey]) {
      return {
        success: false,
        skipped: true,
        reason: 'FEATURE_DISABLED',
        feature: featureKey,
      };
    }

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail(mailOptions);
      return {
        success: true,
        skipped: false,
        messageId: info?.messageId,
      };
    } catch (error) {
      console.error(`[EmailService] Failed to send ${logContext}:`, error?.message || error);
      throw error;
    }
  }

  // ==========================================================================
  // APPOINTMENT NOTIFICATIONS
  // ==========================================================================

  /**
   * Sends appointment confirmation email to the patient.
   */
  async sendPatientAppointmentEmail({ patientEmail, patientName, doctorName, bookingDetails }) {
    const { date, time, type, patientType, fee } = bookingDetails || {};
    const visitTypeString =
      patientType === 'NEW'
        ? 'New Consultation'
        : patientType === 'FOLLOW_UP'
        ? 'Follow-up Appointment'
        : 'Appointment';

    const mailOptions = {
      from: this.getSenderAddress(),
      to: `"${patientName || 'Patient'}" <${patientEmail}>`,
      subject: 'Appointment Booking Confirmation',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #1f2937; text-align: center;">${visitTypeString} Confirmed</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            Hello ${patientName || 'Patient'}, your ${visitTypeString.toLowerCase()} has been successfully scheduled.
          </p>
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0; color: #374151;"><strong>Doctor:</strong> Dr. ${doctorName || 'Doctor'}</p>
            <p style="margin: 5px 0; color: #374151;"><strong>Date & Time:</strong> ${date} at ${time}</p>
            <p style="margin: 5px 0; color: #374151;"><strong>Consultation Type:</strong> ${type}</p>
            <p style="margin: 5px 0; color: #374151;"><strong>Fee Paid:</strong> ₹${fee}</p>
          </div>
          <p style="color: #9ca3af; font-size: 14px; text-align: center;">
            Thank you for choosing ZyDoc Consulting.
          </p>
        </div>
      `,
    };

    return await this._dispatchEmail({
      featureKey: 'PATIENT_BOOKING_CONFIRMATION',
      mailOptions,
      logContext: 'Patient Booking Confirmation',
    });
  }

  /**
   * Sends appointment notification email to the doctor.
   */
  async sendDoctorAppointmentEmail({ doctorEmail, doctorName, patientName, bookingDetails }) {
    const { date, time, type, patientType, reason } = bookingDetails || {};
    const visitTypeString =
      patientType === 'NEW'
        ? 'New Consultation'
        : patientType === 'FOLLOW_UP'
        ? 'Follow-up Appointment'
        : 'Appointment';

    const mailOptions = {
      from: this.getSenderAddress(),
      to: `"${doctorName || 'Doctor'}" <${doctorEmail}>`,
      subject: 'New Appointment Booking',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #1f2937; text-align: center;">${visitTypeString} Scheduled</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            Hello Dr. ${doctorName || 'Doctor'}, you have a ${visitTypeString.toLowerCase()} booking.
          </p>
          <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0; color: #374151;"><strong>Patient:</strong> ${patientName || 'Patient'}</p>
            <p style="margin: 5px 0; color: #374151;"><strong>Date & Time:</strong> ${date} at ${time}</p>
            <p style="margin: 5px 0; color: #374151;"><strong>Consultation Type:</strong> ${type}</p>
            <p style="margin: 5px 0; color: #374151;"><strong>Reason/Notes:</strong> ${reason || 'N/A'}</p>
          </div>
          <p style="color: #9ca3af; font-size: 14px; text-align: center;">
            Please check your dashboard for more details.
          </p>
        </div>
      `,
    };

    return await this._dispatchEmail({
      featureKey: 'DOCTOR_BOOKING_NOTIFICATION',
      mailOptions,
      logContext: 'Doctor Booking Notification',
    });
  }

  /**
   * Unified booking confirmation dispatcher for callers that send both patient & doctor emails.
   * Gated independently by PATIENT_BOOKING_CONFIRMATION and DOCTOR_BOOKING_NOTIFICATION.
   */
  async sendBookingConfirmation({ patientEmail, doctorEmail, patientName, doctorName, bookingDetails }) {
    const results = await Promise.allSettled([
      patientEmail
        ? this.sendPatientAppointmentEmail({ patientEmail, patientName, doctorName, bookingDetails })
        : Promise.resolve({ success: false, skipped: true, reason: 'NO_PATIENT_EMAIL' }),
      doctorEmail
        ? this.sendDoctorAppointmentEmail({ doctorEmail, doctorName, patientName, bookingDetails })
        : Promise.resolve({ success: false, skipped: true, reason: 'NO_DOCTOR_EMAIL' }),
    ]);

    return {
      patientResult: results[0].status === 'fulfilled' ? results[0].value : { success: false, error: results[0].reason?.message },
      doctorResult: results[1].status === 'fulfilled' ? results[1].value : { success: false, error: results[1].reason?.message },
    };
  }

  // ==========================================================================
  // AUTHENTICATION & OTP NOTIFICATIONS
  // ==========================================================================

  /**
   * Internal generator for standard OTP verification email options.
   * @private
   */
  _buildOtpMailOptions(email, otp, title = 'Verify Your Account', introText = 'Hello, thank you for registering with ZyDoc. Please use the verification code below to complete your registration. This code is valid for 10 minutes.') {
    return {
      from: this.getSenderAddress(),
      to: email,
      subject: 'Your Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #1f2937; text-align: center;">${title}</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            ${introText}
          </p>
          <div style="background-color: #f3f4f6; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <h1 style="color: #2563eb; font-size: 32px; letter-spacing: 5px; margin: 0;">${otp}</h1>
          </div>
          <p style="color: #9ca3af; font-size: 14px; text-align: center;">
            If you did not request this email, you can safely ignore it.
          </p>
        </div>
      `,
    };
  }

  /**
   * Sends OTP email for signup registration.
   */
  async sendSignupOtpEmail({ email, otp }) {
    const mailOptions = this._buildOtpMailOptions(
      email,
      otp,
      'Verify Your Account',
      'Hello, thank you for registering with ZyDoc. Please use the verification code below to complete your registration. This code is valid for 10 minutes.'
    );

    return await this._dispatchEmail({
      featureKey: 'SIGNUP_OTP',
      mailOptions,
      logContext: 'Signup OTP',
    });
  }

  /**
   * Sends OTP email for resend OTP requests.
   */
  async sendResendOtpEmail({ email, otp }) {
    const mailOptions = this._buildOtpMailOptions(
      email,
      otp,
      'New Verification Code',
      'You requested a new verification code. Please use the code below to verify your ZyDoc account. This code is valid for 10 minutes.'
    );

    return await this._dispatchEmail({
      featureKey: 'RESEND_OTP',
      mailOptions,
      logContext: 'Resend OTP',
    });
  }

  /**
   * Sends rescue OTP email when an unverified user attempts to log in.
   */
  async sendLoginRescueOtpEmail({ email, otp }) {
    const mailOptions = this._buildOtpMailOptions(
      email,
      otp,
      'Verify Your Account to Log In',
      'Your ZyDoc account requires verification before logging in. Please use the code below to complete your verification.'
    );

    return await this._dispatchEmail({
      featureKey: 'LOGIN_RESCUE_OTP',
      mailOptions,
      logContext: 'Login Rescue OTP',
    });
  }

  /**
   * Sends OTP email for password reset requests.
   */
  async sendForgotPasswordOtpEmail({ email, otp }) {
    const mailOptions = this._buildOtpMailOptions(
      email,
      otp,
      'Reset Your Password',
      'We received a request to reset your ZyDoc account password. Please use the verification code below to proceed. This code is valid for 10 minutes.'
    );

    return await this._dispatchEmail({
      featureKey: 'FORGOT_PASSWORD_OTP',
      mailOptions,
      logContext: 'Forgot Password OTP',
    });
  }

  /**
   * Generic backwards-compatible OTP dispatch method.
   * Maps context to the corresponding feature flag.
   */
  async sendOtpEmail(email, otp, context = 'SIGNUP_OTP') {
    switch (context) {
      case 'FORGOT_PASSWORD':
      case 'FORGOT_PASSWORD_OTP':
        return await this.sendForgotPasswordOtpEmail({ email, otp });
      case 'RESEND':
      case 'RESEND_OTP':
        return await this.sendResendOtpEmail({ email, otp });
      case 'LOGIN_RESCUE':
      case 'LOGIN_RESCUE_OTP':
        return await this.sendLoginRescueOtpEmail({ email, otp });
      case 'SIGNUP':
      case 'SIGNUP_OTP':
      default:
        return await this.sendSignupOtpEmail({ email, otp });
    }
  }

  // ==========================================================================
  // REFUND NOTIFICATIONS
  // ==========================================================================

  /**
   * Sends email notification when a refund request is approved.
   */
  async sendRefundApprovedEmail({ patientEmail, patientName = 'Patient', refundAmount, ticketId, note = '' }) {
    const mailOptions = {
      from: this.getSenderAddress(),
      to: `"${patientName}" <${patientEmail}>`,
      subject: 'Refund Request Approved - ZyDoc',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #16a34a; text-align: center;">Refund Request Approved</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            Hello ${patientName}, your refund request (Ticket #${ticketId}) has been reviewed and approved.
          </p> 
          <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #bbf7d0;">
            <p style="margin: 5px 0; color: #166534; font-size: 18px;"><strong>Amount Credited:</strong> ₹${refundAmount}</p>
            <p style="margin: 5px 0; color: #374151;"><strong>Method:</strong> Credited to your ZyDoc Wallet</p>
            ${note ? `<p style="margin: 5px 0; color: #374151;"><strong>Admin Note:</strong> ${note}</p>` : ''}
          </div>
          <p style="color: #6b7280; font-size: 14px;">
            The credited amount is immediately available in your wallet for booking future appointments.
          </p>
        </div>
      `,
    };

    return await this._dispatchEmail({
      featureKey: 'REFUND_APPROVED',
      mailOptions,
      logContext: 'Refund Approved Email',
    });
  }

  /**
   * Sends email notification when a refund request is denied.
   */
  async sendRefundRejectedEmail({ patientEmail, patientName = 'Patient', ticketId, reason }) {
    const mailOptions = {
      from: this.getSenderAddress(),
      to: `"${patientName}" <${patientEmail}>`,
      subject: 'Refund Request Update - ZyDoc',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #dc2626; text-align: center;">Refund Request Denied</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            Hello ${patientName}, after reviewing your refund request (Ticket #${ticketId}), we regret to inform you that it was denied.
          </p>
          <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #fecaca;">
            <p style="margin: 5px 0; color: #991b1b;"><strong>Reason:</strong> ${reason}</p>
          </div>
          <p style="color: #9ca3af; font-size: 14px; text-align: center;">
            If you have questions regarding this decision, please contact ZyDoc support.
          </p>
        </div>
      `,
    };

    return await this._dispatchEmail({
      featureKey: 'REFUND_REJECTED',
      mailOptions,
      logContext: 'Refund Rejected Email',
    });
  }

  // ==========================================================================
  // DOCTOR VERIFICATION NOTIFICATIONS
  // ==========================================================================

  /**
   * Sends email notification when a doctor application is approved.
   */
  async sendDoctorApplicationApprovedEmail({ doctorEmail, doctorName = 'Doctor' }) {
    const mailOptions = {
      from: this.getSenderAddress(),
      to: `"${doctorName}" <${doctorEmail}>`,
      subject: 'ZyDoc Doctor Application Approved',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #16a34a; text-align: center;">Application Approved</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            Congratulations Dr. ${doctorName}! Your application to join ZyDoc Consulting has been approved.
          </p>
          <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #bbf7d0;">
            <p style="margin: 5px 0; color: #166534;">Your profile is now verified and active. You can log in and start receiving consultation bookings.</p>
          </div>
        </div>
      `,
    };

    return await this._dispatchEmail({
      featureKey: 'DOCTOR_APPLICATION_APPROVED',
      mailOptions,
      logContext: 'Doctor Application Approved Email',
    });
  }

  /**
   * Sends email notification when a doctor application is rejected.
   */
  async sendDoctorApplicationRejectedEmail({ doctorEmail, doctorName = 'Doctor', reason }) {
    const mailOptions = {
      from: this.getSenderAddress(),
      to: `"${doctorName}" <${doctorEmail}>`,
      subject: 'ZyDoc Doctor Application Status Update',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #dc2626; text-align: center;">Application Status Update</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            Hello Dr. ${doctorName}, thank you for your interest in ZyDoc Consulting.
          </p>
          <div style="background-color: #fef2f2; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #fecaca;">
            <p style="margin: 5px 0; color: #991b1b;"><strong>Reason:</strong> ${reason}</p>
          </div>
        </div>
      `,
    };

    return await this._dispatchEmail({
      featureKey: 'DOCTOR_APPLICATION_REJECTED',
      mailOptions,
      logContext: 'Doctor Application Rejected Email',
    });
  }
}

// Export singleton instance for direct import where appropriate
export const emailService = new EmailService();
