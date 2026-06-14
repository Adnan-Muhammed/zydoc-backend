

// src/infrastructure/security/MailService.js



import nodemailer from 'nodemailer';

export class MailService {
    constructor() {
        console.log("[MAILER] Configuring with Host:", process.env.EMAIL_HOST);
        this.transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            secure: false, // true for 465, false for other ports
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });
    }

    async sendOtpEmail(email, otp) {
        console.log('-=-=-==--=-=-=-=-=-=-=-=-=-=-==-=-=-=-=-=');
        console.log(email, otp);
        console.log('-=-=-==--=-=-=-=-=-=-=-=-=-=-==-=-=-=-=-=');


        const mailOptions = {
            // from: `"ZyDoc Consulting" <${process.env.EMAIL_USER}>`,
            from: `"ZyDoc Consulting env. adnan.shajahan786@gmail.com"`,
            to: email,
            subject: 'Your Verification Code',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #1f2937; text-align: center;">Verify Your Account</h2>
                    <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
                        Hello, thank you for registering with ZyDoc. Please use the verification code below to complete your registration. This code is valid for 10 minutes.
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

        try {
            const info = await this.transporter.sendMail(mailOptions);
            return info;
        } catch (error) {
            console.error("Error sending email:", error);
            throw new Error("Email delivery service failed");
        }
    }
}