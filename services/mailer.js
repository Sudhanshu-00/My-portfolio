/**
 * Mailer — Gmail SMTP (env se creds, koi hardcoded secret nahi).
 * SMTP_PASS = Gmail "App Password" (2FA enable karke banate hain, 16-char).
 * SMTP configure na ho to DEV fallback: OTP server console pe log hota hai.
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
    console.warn('⚠️  SMTP not configured (.env me SMTP_PASS bharo) — DEV fallback, email nahi gaya:');
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
