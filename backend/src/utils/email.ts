import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const normalizeEmailAddress = (value?: string) => String(value || '').trim();
const isValidEmailAddress = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const sendEmail = async (to: string, subject: string, text: string, html?: string, retryCount = 0) => {
  console.log('[Email] Sending email via Brevo API:');
  console.log('  BREVO_API_KEY:', process.env.BREVO_API_KEY ? '[SET]' : '[NOT SET]');
  console.log('  EMAIL_FROM:', process.env.EMAIL_FROM);
  console.log('  To:', to);
  console.log('  Subject:', subject);
  if (retryCount > 0) {
    console.log(`  Retry attempt: ${retryCount}/${MAX_RETRIES}`);
  }

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

  const brevoApiKey = process.env.BREVO_API_KEY || process.env.SMTP_PASS;
  if (!brevoApiKey) {
    console.error('[Email] Error: Brevo API key is missing (set BREVO_API_KEY or SMTP_PASS).');
    return Promise.reject(new Error('Brevo API key is missing.'));
  }

  if (!recipient || !isValidEmailAddress(recipient)) {
    console.error('[Email] Error: Invalid recipient:', recipient);
    return Promise.reject(new Error(`Recipient email is invalid: ${recipient || '(empty)'}`));
  }

  try {
    const response = await axios.post(
      BREVO_API_URL,
      {
        sender: { email: from, name: 'Madison88 BMS' },
        to: [{ email: recipient }],
        subject: subject,
        htmlContent: html || `<div style="font-family: Arial, sans-serif;">${text}</div>`,
        textContent: text
      },
      {
        headers: {
          'accept': 'application/json',
          'api-key': brevoApiKey,
          'content-type': 'application/json'
        },
        timeout: 10000
      }
    );

    console.log('[Email] Email sent successfully via Brevo API!');
    console.log('  Brevo message ID:', response.data.messageId);
    return response.data;
  } catch (error: any) {
    console.error('[Email] Error sending email via Brevo API:', error.response?.data || error.message);
    console.error('  Error code:', error.response?.status || error.code);
    
    // Retry on network errors or 5xx errors
    const isRetryable = !error.response || (error.response?.status >= 500);
    if (isRetryable && retryCount < MAX_RETRIES) {
      console.log(`[Email] Retrying in ${RETRY_DELAY_MS}ms...`);
      await sleep(RETRY_DELAY_MS);
      return sendEmail(to, subject, text, html, retryCount + 1);
    }
    
    // Log critical email failures for monitoring
    if (retryCount === MAX_RETRIES || !isRetryable) {
      console.error('[Email] CRITICAL: Email failed after retries or non-retryable error');
      console.error(`[Email] Failed to send email to: ${recipient}`);
      console.error(`[Email] Subject: ${subject}`);
      // In production, this should trigger an alert to admin
      // TODO: Integrate with monitoring/alerting system
    }
    
    throw error;
  }
};
