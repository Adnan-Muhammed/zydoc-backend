// src/infrastructure/security/MailService.js

/**
 * Backward compatibility adapter for legacy MailService imports.
 * Centralized logic is managed in src/infrastructure/services/EmailService.js.
 */
import { EmailService, EMAIL_FEATURES, emailService } from '../services/EmailService.js';

export class MailService extends EmailService {
  constructor(customTransporter = null) {
    super(customTransporter);
  }
}

export { EMAIL_FEATURES, emailService };
export default MailService;