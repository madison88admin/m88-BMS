import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const normalizeEmailAddress = (value?: string) => String(value || '').trim();
const isValidEmailAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 465),
  secure: String(process.env.SMTP_SECURE || process.env.EMAIL_SECURE || 'true').toLowerCase() === 'true',
  auth:
    (process.env.SMTP_USER || process.env.EMAIL_USER) && (process.env.SMTP_PASS || process.env.EMAIL_PASS)
      ? {
          user: process.env.SMTP_USER || process.env.EMAIL_USER,
          pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
        }
      : undefined,
  tls: {
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2'
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
  debug: true,
  logger: true
});

export const sendEmail = (to: string, subject: string, text: string, html?: string) => {
  console.log('[Email] Sending email:');
  console.log('  SMTP_HOST:', process.env.SMTP_HOST || process.env.EMAIL_HOST);
  console.log('  SMTP_PORT:', process.env.SMTP_PORT || process.env.EMAIL_PORT);
  console.log('  SMTP_SECURE:', process.env.SMTP_SECURE || process.env.EMAIL_SECURE);
  console.log('  SMTP_USER:', process.env.SMTP_USER || process.env.EMAIL_USER ? '[SET]' : '[NOT SET]');
  console.log('  SMTP_PASS:', process.env.SMTP_PASS || process.env.EMAIL_PASS ? '[SET]' : '[NOT SET]');
  console.log('  EMAIL_FROM:', process.env.EMAIL_FROM || process.env.SMTP_FROM);
  console.log('  To:', to);
  console.log('  Subject:', subject);

  const from = normalizeEmailAddress(process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || process.env.EMAIL_USER);
  const recipient = normalizeEmailAddress(to);

  if (!from) {
    console.error('[Email] Error: Email sender is not configured.');
    return Promise.reject(new Error('Email sender is not configured.'));
  }

  if (!isValidEmailAddress(from)) {
    console.error('[Email] Error: Invalid sender address:', from);
    return Promise.reject(new Error('Email sender address is invalid.'));
  }

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('[Email] Error: SMTP credentials are missing.');
    return Promise.reject(new Error('SMTP credentials are missing.'));
  }

  if (!recipient || !isValidEmailAddress(recipient)) {
    console.error('[Email] Error: Invalid recipient:', recipient);
    return Promise.reject(new Error(`Recipient email is invalid: ${recipient || '(empty)'}`));
  }

  console.log('[Email] Sending email via transporter...');
  return transporter.sendMail({ from, to: recipient, subject, text, html })
    .then((info) => {
      console.log('[Email] Email sent successfully!');
      console.log('  Message ID:', info.messageId);
      console.log('  Response:', info.response);
      return info;
    })
    .catch((error: any) => {
      console.error('[Email] Error sending email:', error);
      console.error('  Error code:', error.code);
      console.error('  Error message:', error.message);
      console.error('  Response:', error.response);
      const message = String(error?.message || '');

      if (/Invalid to/i.test(message)) {
        throw new Error(`Recipient email was rejected by the mail server: ${recipient}`);
      }

      throw error;
    });
};
