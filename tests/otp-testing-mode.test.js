// tests/otp-testing-mode.test.js

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_FEATURES, EmailService } from '../src/infrastructure/services/EmailService.js';
import { SignupUser } from '../src/application/usecases/auth/SignupUser.js';
import { ResendOtp } from '../src/application/usecases/auth/ResendOtp.js';
import { ForgotPassword } from '../src/application/usecases/auth/ForgotPassword.js';
import { LoginUser, UnverifiedAccountError } from '../src/application/usecases/auth/LoginUser.js';

describe('OTP Testing Mode: Conditional Redirection and Payload Inclusion', () => {
  let mockUserRepo;
  let mockAuthService;
  let mockOtpService;
  let mockMailService;
  let sentMails;

  beforeEach(() => {
    process.env.ADMIN_EMAIL = 'admin@zydoc.com';
    sentMails = [];
    mockMailService = new EmailService({
      sendMail: async (opts) => {
        sentMails.push(opts);
        return { messageId: 'test-msg-1' };
      },
    });

    mockUserRepo = {
      users: new Map(),
      async findByEmail(email) {
        return this.users.get(email) || null;
      },
      async findById(id) {
        return this.users.get(id) || null;
      },
      async createWithProfile(userEntity) {
        const id = 'user-id-123';
        const doc = { id, _id: id, ...userEntity };
        this.users.set(userEntity.email, doc);
        return doc;
      },
      async update(user) {
        this.users.set(user.email, user);
        return user;
      },
      async updateOtp(userId, code, expiresAt) {
        for (const [email, u] of this.users.entries()) {
          if (u.id === userId || u._id === userId) {
            u.otp = { code, expiresAt };
            this.users.set(email, u);
            return u;
          }
        }
      },
      async delete(id) {
        for (const [email, u] of this.users.entries()) {
          if (u.id === id || u._id === id) {
            this.users.delete(email);
          }
        }
      },
    };

    mockAuthService = {
      hashPassword: async (pwd) => `hashed_${pwd}`,
      comparePassword: async (plain, hashed) => hashed === `hashed_${plain}`,
      generateSignupToken: (id) => `signup_token_${id}`,
      verifySignupToken: () => null,
      generateAccessToken: () => 'access-token',
      generateRefreshToken: () => 'refresh-token',
    };

    mockOtpService = {
      generateOtp: () => ({ code: '654321', expiresAt: new Date(Date.now() + 600000) }),
    };
  });

  it('1. SignupUser: Returns OTP in response & sends to Admin when SIGNUP_OTP is false', async () => {
    EMAIL_FEATURES.SIGNUP_OTP = false;

    const usecase = new SignupUser(mockUserRepo, mockAuthService, mockOtpService, mockMailService);
    const result = await usecase.execute({
      name: 'Dr. Alice',
      email: 'alice@doctor.com',
      password: 'Password123!',
      role: 'doctor',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.otp, '654321', 'OTP must be passed in response when false');
    assert.strictEqual(result.code, '654321');
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'admin@zydoc.com', 'Sent to admin instead of user');
    assert.ok(sentMails[0].html.includes('Doctor'), 'Contains user role');
    assert.ok(sentMails[0].html.includes('alice@doctor.com'), 'Contains user email');
    assert.ok(sentMails[0].html.includes('654321'), 'Contains OTP');
    assert.ok(sentMails[0].html.includes('Signup OTP'), 'Contains service name');
  });

  it('2. SignupUser: Does NOT return OTP in response & sends to user when SIGNUP_OTP is true', async () => {
    EMAIL_FEATURES.SIGNUP_OTP = true;

    const usecase = new SignupUser(mockUserRepo, mockAuthService, mockOtpService, mockMailService);
    const result = await usecase.execute({
      name: 'Bob Patient',
      email: 'bob@patient.com',
      password: 'Password123!',
      role: 'patient',
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.otp, undefined, 'OTP must NOT be in response when true');
    assert.strictEqual(result.code, undefined);
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'bob@patient.com', 'Sent to user email');
  });

  it('3. ResendOtp: Returns OTP in response & sends to Admin when RESEND_OTP is false', async () => {
    EMAIL_FEATURES.RESEND_OTP = false;
    mockUserRepo.users.set('resend@doctor.com', {
      id: 'doc-1',
      email: 'resend@doctor.com',
      role: 'doctor',
      isVerified: false,
    });

    const usecase = new ResendOtp(mockUserRepo, mockOtpService, mockMailService);
    const result = await usecase.execute('resend@doctor.com');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.otp, '654321');
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'admin@zydoc.com');
    assert.ok(sentMails[0].html.includes('Doctor'));
    assert.ok(sentMails[0].html.includes('Resend OTP'));
  });

  it('4. ResendOtp: Does NOT return OTP in response when RESEND_OTP is true', async () => {
    EMAIL_FEATURES.RESEND_OTP = true;
    mockUserRepo.users.set('resend@patient.com', {
      id: 'pat-1',
      email: 'resend@patient.com',
      role: 'patient',
      isVerified: false,
    });

    const usecase = new ResendOtp(mockUserRepo, mockOtpService, mockMailService);
    const result = await usecase.execute('resend@patient.com');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.otp, undefined);
    assert.strictEqual(result.code, undefined);
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'resend@patient.com');
  });

  it('5. ForgotPassword: Returns OTP in response & sends to Admin when FORGOT_PASSWORD_OTP is false', async () => {
    EMAIL_FEATURES.FORGOT_PASSWORD_OTP = false;
    mockUserRepo.users.set('forgot@test.com', {
      id: 'u-1',
      email: 'forgot@test.com',
      role: 'doctor',
      isVerified: true,
    });

    const usecase = new ForgotPassword(mockUserRepo, mockOtpService, mockMailService);
    const result = await usecase.execute({ email: 'forgot@test.com' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.otp, '654321');
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'admin@zydoc.com');
    assert.ok(sentMails[0].html.includes('Doctor'));
    assert.ok(sentMails[0].html.includes('Forgot Password OTP'));
  });

  it('6. ForgotPassword: Does NOT return OTP in response when FORGOT_PASSWORD_OTP is true', async () => {
    EMAIL_FEATURES.FORGOT_PASSWORD_OTP = true;
    mockUserRepo.users.set('forgot@test.com', {
      id: 'u-1',
      email: 'forgot@test.com',
      role: 'patient',
      isVerified: true,
    });

    const usecase = new ForgotPassword(mockUserRepo, mockOtpService, mockMailService);
    const result = await usecase.execute({ email: 'forgot@test.com' });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.otp, undefined);
    assert.strictEqual(result.code, undefined);
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'forgot@test.com');
  });

  it('7. LoginUser: Attaches OTP to UnverifiedAccountError when LOGIN_RESCUE_OTP is false', async () => {
    EMAIL_FEATURES.LOGIN_RESCUE_OTP = false;
    mockUserRepo.users.set('unverified@test.com', {
      id: 'u-unverified',
      email: 'unverified@test.com',
      password: 'hashed_Password123!',
      role: 'doctor',
      isVerified: false,
    });

    const usecase = new LoginUser(mockUserRepo, mockAuthService, mockOtpService, mockMailService);
    
    let caughtError = null;
    try {
      await usecase.execute({ email: 'unverified@test.com', password: 'Password123!' });
    } catch (e) {
      caughtError = e;
    }

    assert.ok(caughtError instanceof UnverifiedAccountError);
    assert.strictEqual(caughtError.otp, '654321', 'Must attach OTP to error in false/test mode');
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'admin@zydoc.com');
    assert.ok(sentMails[0].html.includes('Doctor'));
    assert.ok(sentMails[0].html.includes('Login Rescue OTP'));
  });

  it('8. LoginUser: Does NOT attach OTP to UnverifiedAccountError when LOGIN_RESCUE_OTP is true', async () => {
    EMAIL_FEATURES.LOGIN_RESCUE_OTP = true;
    mockUserRepo.users.set('unverified@test.com', {
      id: 'u-unverified',
      email: 'unverified@test.com',
      password: 'hashed_Password123!',
      role: 'patient',
      isVerified: false,
    });

    const usecase = new LoginUser(mockUserRepo, mockAuthService, mockOtpService, mockMailService);
    
    let caughtError = null;
    try {
      await usecase.execute({ email: 'unverified@test.com', password: 'Password123!' });
    } catch (e) {
      caughtError = e;
    }

    assert.ok(caughtError instanceof UnverifiedAccountError);
    assert.strictEqual(caughtError.otp, null, 'Must NOT attach OTP to error when true');
    assert.strictEqual(sentMails.length, 1);
    assert.strictEqual(sentMails[0].to, 'unverified@test.com');
  });
});
