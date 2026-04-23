import assert from 'node:assert/strict';
import test from 'node:test';
import { createOtpDeliveryService } from '../src/server/otpDelivery.js';

test('otp delivery writes to console when smtp host is blank', async () => {
  const messages = [];
  const service = createOtpDeliveryService({
    smtp: { host: '' },
    logger: {
      log(message) {
        messages.push(message);
      }
    }
  });

  const result = await service.sendOtpEmail({
    to: 'user@example.com',
    subject: 'OTP',
    otp: '123456',
    intro: 'Intro'
  });

  assert.equal(result.mode, 'console');
  assert.match(result.warning, /server console/i);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /\[DEV OTP\]/);
  assert.match(messages[0], /123456/);
});

test('otp delivery uses smtp when transport succeeds', async () => {
  const sent = [];
  const service = createOtpDeliveryService({
    smtp: {
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      from: 'no-reply@example.com'
    },
    transporterFactory(config) {
      assert.equal(config.host, 'smtp.example.com');
      return {
        async sendMail(message) {
          sent.push(message);
        }
      };
    }
  });

  const result = await service.sendOtpEmail({
    to: 'user@example.com',
    subject: 'OTP',
    otp: '123456',
    intro: 'Intro'
  });

  assert.equal(result.mode, 'email');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'user@example.com');
});

test('otp delivery falls back to console on smtp failure when allowed', async () => {
  const logs = [];
  const warnings = [];
  const service = createOtpDeliveryService({
    smtp: {
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      from: 'no-reply@example.com'
    },
    allowConsoleFallbackOnSmtpFailure: true,
    logger: {
      log(message) {
        logs.push(message);
      },
      warn(message) {
        warnings.push(message);
      }
    },
    transporterFactory() {
      return {
        async sendMail() {
          throw new Error('getaddrinfo ENOTFOUND smtp.example.com');
        }
      };
    }
  });

  const result = await service.sendOtpEmail({
    to: 'user@example.com',
    subject: 'OTP',
    otp: '123456',
    intro: 'Intro'
  });

  assert.equal(result.mode, 'console');
  assert.match(result.warning, /SMTP delivery failed/i);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ENOTFOUND/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /123456/);
});

test('otp delivery rethrows smtp failure when console fallback is disabled', async () => {
  const service = createOtpDeliveryService({
    smtp: {
      host: 'smtp.example.com',
      port: 25,
      secure: false,
      from: 'no-reply@example.com'
    },
    transporterFactory() {
      return {
        async sendMail() {
          throw new Error('smtp rejected sender');
        }
      };
    }
  });

  await assert.rejects(
    service.sendOtpEmail({
      to: 'user@example.com',
      subject: 'OTP',
      otp: '123456',
      intro: 'Intro'
    }),
    /smtp rejected sender/
  );
});
