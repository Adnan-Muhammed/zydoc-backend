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
  PATIENT_BOOKING_CONFIRMATION: false,
  DOCTOR_BOOKING_NOTIFICATION: true,

  // Authentication & OTP notifications
  SIGNUP_OTP: false,
  RESEND_OTP: false,
  LOGIN_RESCUE_OTP: false,
  FORGOT_PASSWORD_OTP: false,

  // Admin action notifications
  REFUND_APPROVED: true,
  REFUND_REJECTED: true,
  DOCTOR_APPLICATION_APPROVED: true,
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
    return `"Zydocare Health" <${user}>`;
  }

  /**
   * Helper to resolve the designated admin notification email address.
   */
  getAdminEmailAddress() {
    return process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'admin@zydoc.com';
  }

  /**
   * Builds mail options for redirecting OTP emails to Admin when feature flag is disabled.
   * Includes generated OTP, user's email, user's role, and email type / service name.
   * @private
   */
  _buildAdminOtpMailOptions({ adminEmail, userEmail, otp, role = 'patient', serviceName, featureKey }) {
    const formattedRole = role ? (role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()) : 'Patient';

    return {
      from: this.getSenderAddress(),
      to: adminEmail,
      subject: `[TESTING MODE] ${serviceName} Notification - ${userEmail}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 24px; border-radius: 8px; background-color: #ffffff;">
          <div style="background-color: #fef3c7; border: 1px solid #f59e0b; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px;">
            <h3 style="margin: 0; color: #92400e; font-size: 15px; font-weight: bold;">⚠️ Testing / Spam Prevention Mode Active</h3>
            <p style="margin: 4px 0 0 0; color: #b45309; font-size: 13px; line-height: 1.4;">
              Feature flag <code>${featureKey}</code> is set to <strong>false</strong>. This OTP email was intercepted and redirected to the Administrator instead of the user's actual email.
            </p>
          </div>

          <h2 style="color: #1f2937; margin-top: 0; font-size: 20px; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px;">
            ${serviceName} Intercepted
          </h2>

          <div style="background-color: #f8fafc; padding: 18px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
            <p style="margin: 6px 0; color: #334155; font-size: 14px;"><strong>Email Type / Service Name:</strong> ${serviceName}</p>
            <p style="margin: 6px 0; color: #334155; font-size: 14px;"><strong>User's Email:</strong> <span style="color: #2563eb; font-weight: 600;">${userEmail}</span></p>
            <p style="margin: 6px 0; color: #334155; font-size: 14px;"><strong>User's Role:</strong> <span style="background-color: #e0e7ff; color: #3730a3; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; text-transform: uppercase;">${formattedRole}</span></p>
            
            <div style="margin-top: 20px; text-align: center; background-color: #ffffff; padding: 20px; border-radius: 8px; border: 2px dashed #2563eb;">
              <span style="font-size: 12px; font-weight: bold; color: #64748b; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 6px;">Generated OTP Code</span>
              <span style="font-size: 34px; font-weight: 800; font-family: 'Courier New', Courier, monospace; letter-spacing: 6px; color: #1d4ed8;">${otp}</span>
            </div>
          </div>

          <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 15px 0 0 0;">
            Zydocare Health Security &amp; Testing Notification • Timestamp: ${new Date().toISOString()}
          </p>
        </div>
      `,
      text: `[TESTING MODE] ${serviceName} Notification\n\n` +
        `This OTP was redirected to the administrator because ${featureKey} is disabled (false).\n\n` +
        `Email Type / Service Name: ${serviceName}\n` +
        `User Email: ${userEmail}\n` +
        `User Role: ${formattedRole}\n` +
        `Generated OTP: ${otp}\n` +
        `Timestamp: ${new Date().toISOString()}\n`,
    };
  }

  /**
   * Dispatches an OTP email conditionally:
   * - If feature is enabled (true): sends normal email to user's actual email address.
   * - If feature is disabled (false): redirects email to the admin email address with user/role/OTP details.
   * @private
   */
  async _dispatchOtpEmail({ featureKey, userEmail, otp, role = 'patient', serviceName, userMailOptions, logContext }) {
    const isFeatureEnabled = !!EMAIL_FEATURES[featureKey];

    if (isFeatureEnabled) {
      try {
        const transporter = this.getTransporter();
        const info = await transporter.sendMail(userMailOptions);
        return {
          success: true,
          skipped: false,
          redirectedToAdmin: false,
          recipient: userEmail,
          messageId: info?.messageId,
        };
      } catch (error) {
        console.error(`[EmailService] Failed to send ${logContext} to ${userEmail}:`, error?.message || error);
        throw error;
      }
    }

    // Testing / false condition: Do NOT send to user; redirect directly to Admin
    const adminEmail = this.getAdminEmailAddress();
    const adminMailOptions = this._buildAdminOtpMailOptions({
      adminEmail,
      userEmail,
      otp,
      role,
      serviceName,
      featureKey,
    });

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail(adminMailOptions);
      return {
        success: true,
        skipped: false,
        redirectedToAdmin: true,
        recipient: adminEmail,
        messageId: info?.messageId,
      };
    } catch (error) {
      console.error(`[EmailService] Failed to send ${logContext} to admin (${adminEmail}):`, error?.message || error);
      // Return safe failure in test/dev so the overall auth/OTP flow is not broken
      return {
        success: false,
        skipped: false,
        redirectedToAdmin: true,
        recipient: adminEmail,
        error: error?.message || String(error),
      };
    }
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
            Thank you for choosing Zydocare Health.
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
  _buildOtpMailOptions(email, otp, title = 'Verify Your Account', introText = 'Hello, thank you for registering with Zydocare Health. Please use the verification code below to complete your registration. This code is valid for 10 minutes.') {
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
  async sendSignupOtpEmail({ email, otp, role = 'patient' }) {
    const mailOptions = this._buildOtpMailOptions(
      email,
      otp,
      'Verify Your Account',
      'Hello, thank you for registering with Zydocare Health. Please use the verification code below to complete your registration. This code is valid for 10 minutes.'
    );

    return await this._dispatchOtpEmail({
      featureKey: 'SIGNUP_OTP',
      userEmail: email,
      otp,
      role,
      serviceName: 'Signup OTP',
      userMailOptions: mailOptions,
      logContext: 'Signup OTP',
    });
  }

  /**
   * Sends OTP email for resend OTP requests.
   */
  async sendResendOtpEmail({ email, otp, role = 'patient' }) {
    const mailOptions = this._buildOtpMailOptions(
      email,
      otp,
      'New Verification Code',
      'You requested a new verification code. Please use the code below to verify your Zydocare Health account. This code is valid for 10 minutes.'
    );

    return await this._dispatchOtpEmail({
      featureKey: 'RESEND_OTP',
      userEmail: email,
      otp,
      role,
      serviceName: 'Resend OTP',
      userMailOptions: mailOptions,
      logContext: 'Resend OTP',
    });
  }

  /**
   * Sends rescue OTP email when an unverified user attempts to log in.
   */
  async sendLoginRescueOtpEmail({ email, otp, role = 'patient' }) {
    const mailOptions = this._buildOtpMailOptions(
      email,
      otp,
      'Verify Your Account to Log In',
      'Your Zydocare Health account requires verification before logging in. Please use the code below to complete your verification.'
    );

    return await this._dispatchOtpEmail({
      featureKey: 'LOGIN_RESCUE_OTP',
      userEmail: email,
      otp,
      role,
      serviceName: 'Login Rescue OTP',
      userMailOptions: mailOptions,
      logContext: 'Login Rescue OTP',
    });
  }

  /**
   * Sends OTP email for password reset requests.
   */
  async sendForgotPasswordOtpEmail({ email, otp, role = 'patient' }) {
    const mailOptions = this._buildOtpMailOptions(
      email,
      otp,
      'Reset Your Password',
      'We received a request to reset your Zydocare Health account password. Please use the verification code below to proceed. This code is valid for 10 minutes.'
    );

    return await this._dispatchOtpEmail({
      featureKey: 'FORGOT_PASSWORD_OTP',
      userEmail: email,
      otp,
      role,
      serviceName: 'Forgot Password OTP',
      userMailOptions: mailOptions,
      logContext: 'Forgot Password OTP',
    });
  }

  /**
   * Generic backwards-compatible OTP dispatch method.
   * Maps context to the corresponding feature flag and passes role.
   */
  async sendOtpEmail(email, otp, context = 'SIGNUP_OTP', role = 'patient') {
    switch (context) {
      case 'FORGOT_PASSWORD':
      case 'FORGOT_PASSWORD_OTP':
        return await this.sendForgotPasswordOtpEmail({ email, otp, role });
      case 'RESEND':
      case 'RESEND_OTP':
        return await this.sendResendOtpEmail({ email, otp, role });
      case 'LOGIN_RESCUE':
      case 'LOGIN_RESCUE_OTP':
        return await this.sendLoginRescueOtpEmail({ email, otp, role });
      case 'SIGNUP':
      case 'SIGNUP_OTP':
      default:
        return await this.sendSignupOtpEmail({ email, otp, role });
    }
  }

  /**
   * Helper to check whether an OTP feature flag is enabled.
   */
  isOtpFeatureEnabled(featureKey) {
    return Boolean(EMAIL_FEATURES[featureKey]);
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
      subject: 'Refund Request Approved - Zydocare Health',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #16a34a; text-align: center;">Refund Request Approved</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            Hello ${patientName}, your refund request (Ticket #${ticketId}) has been reviewed and approved.
          </p> 
          <div style="background-color: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #bbf7d0;">
            <p style="margin: 5px 0; color: #166534; font-size: 18px;"><strong>Amount Credited:</strong> ₹${refundAmount}</p>
            <p style="margin: 5px 0; color: #374151;"><strong>Method:</strong> Credited to your Zydocare Health Wallet</p>
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
      subject: 'Refund Request Update - Zydocare Health',
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
            If you have questions regarding this decision, please contact Zydocare Health support.
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
      subject: 'Zydocare Health Doctor Application Approved',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #16a34a; text-align: center;">Application Approved</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            Congratulations Dr. ${doctorName}! Your application to join Zydocare Health has been approved.
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
      subject: 'Zydocare Health Doctor Application Status Update',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
          <h2 style="color: #dc2626; text-align: center;">Application Status Update</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
            Hello Dr. ${doctorName}, thank you for your interest in Zydocare Health.
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
