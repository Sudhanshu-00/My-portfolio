/**
 * Mailer — Gmail SMTP (creds from env, no hardcoded secrets).
 * SMTP_PASS = Gmail "App Password" (requires 2FA, 16-char).
 * If SMTP is not configured → DEV fallback: OTP is logged to the server console.
 */
const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 465,
    secure: (parseInt(process.env.SMTP_PORT, 10) || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendMail({ to, subject, text, html }) {
  if (!transporter) {
    console.warn('⚠️  SMTP not configured (set SMTP_PASS in .env) — DEV fallback, email was NOT sent:');
    console.warn(`   to=${to} subject=${subject}`);
    return false;
  }
  try {
    await transporter.sendMail({ from: `"Portfolio Admin" <${process.env.SMTP_USER}>`, to, subject, text, html });
    return true;
  } catch (e) {
    console.error('Mail error:', e.message);
    return false;
  }
}

module.exports = { sendMail, mailReady: () => !!transporter };
