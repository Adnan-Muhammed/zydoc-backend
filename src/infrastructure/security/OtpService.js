// src/infrastructure/security/OtpService.js
export class OtpService {
    generateOtp(minutes = 5) {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + minutes * 60000);
        return { code, expiresAt };
    }

    // isValid(userOtp, inputCode) {
    //     if (!userOtp || !userOtp.code) return false;
    //     const isExpired = new Date() > userOtp.expiresAt;
    //     return !isExpired && userOtp.code === inputCode;
    // }

    isValid(userOtp, inputCode) {
        if (!userOtp || !userOtp.code) return false;

        // Ensure userOtp.expiresAt is a Date object. 
        // If it comes from MongoDB, it might need wrapping: new Date(userOtp.expiresAt)
        const expiryDate = new Date(userOtp.expiresAt);
        const isExpired = new Date() > expiryDate;

        console.log('Validating:', { inputCode, dbCode: userOtp.code, isExpired });

        return !isExpired && userOtp.code === inputCode;
    }
}