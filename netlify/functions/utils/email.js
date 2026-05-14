require('dotenv').config();

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.SMTP_PORT || process.env.EMAIL_PORT || 587),
  secure: String(process.env.SMTP_SECURE || process.env.EMAIL_SECURE || 'false').toLowerCase() === 'true',
  auth:
    (process.env.SMTP_USER || process.env.EMAIL_USER) && (process.env.SMTP_PASS || process.env.EMAIL_PASS)
      ? {
          user: process.env.SMTP_USER || process.env.EMAIL_USER,
          pass: process.env.SMTP_PASS || process.env.EMAIL_PASS
        }
      : undefined
});

const sendEmail = async (to, subject, text, html) => {
  const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || process.env.EMAIL_USER;

  if (!from) {
    throw new Error('Email sender is not configured.');
  }

  if (!(process.env.SMTP_USER || process.env.EMAIL_USER) || !(process.env.SMTP_PASS || process.env.EMAIL_PASS)) {
    throw new Error('Email credentials are missing.');
  }

  try {
    await transporter.sendMail({ from, to, subject, text, html });
  } catch (error) {
    console.error('Email error:', error);
    throw error;
  }
};

module.exports = { sendEmail };
