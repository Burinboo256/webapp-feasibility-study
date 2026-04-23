import nodemailer from 'nodemailer';

export function createOtpDeliveryService(options = {}) {
  const smtp = options.smtp || {};
  const logger = options.logger || console;
  const transporterFactory = options.transporterFactory || nodemailer.createTransport;
  const allowConsoleFallbackOnSmtpFailure = options.allowConsoleFallbackOnSmtpFailure === true;

  return {
    async sendOtpEmail({ to, subject, otp, intro, ttlMinutes = 10 }) {
      const text = `${intro}\n\nOTP: ${otp}\n\nThis OTP expires in ${ttlMinutes} minutes.`;

      if (!smtp.host) {
        logDevOtp(logger, to, subject, otp);
        return {
          mode: 'console',
          warning: 'SMTP is not configured. OTP was written to the server console.'
        };
      }

      try {
        const transporter = transporterFactory({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: smtp.user ? {
            user: smtp.user,
            pass: smtp.pass
          } : undefined
        });

        await transporter.sendMail({
          from: smtp.from || smtp.user,
          to,
          subject,
          text
        });

        return { mode: 'email' };
      } catch (error) {
        if (!allowConsoleFallbackOnSmtpFailure) throw error;

        logger.warn?.(
          `[OTP SMTP FALLBACK] ${to} | ${subject} | ${error?.message || 'Unknown SMTP error'}`
        );
        logDevOtp(logger, to, subject, otp);
        return {
          mode: 'console',
          warning: 'SMTP delivery failed. OTP was written to the server console for local testing.'
        };
      }
    }
  };
}

function logDevOtp(logger, to, subject, otp) {
  logger.log?.(`[DEV OTP] ${to} | ${subject} | ${otp}`);
}

