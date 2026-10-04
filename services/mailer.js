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

/**
 * Professional OTP email — shared by signup verification and password reset.
 * Dark terminal theme matching the site. Inline styles only (email-client
 * safe), table-free layout, plain-text fallback included.
 * The OTP appears ONLY inside the email — never in a page response or a URL.
 */
function otpTemplate({ heading, intro, otp, validityMins, name }) {
  const who = name ? `Hi <b style="color:#7ee787">${String(name).replace(/[<>&]/g, '')}</b>,` : 'Hi,';
  const text =
    `${heading}\n` +
    (name ? `Hi ${name},\n` : '') +
    `${intro}\n\n` +
    `Your one-time code: ${otp}\n` +
    `Valid for ${validityMins} minutes.\n\n` +
    `Never share this code with anyone — we will never ask for it.\n` +
    `Didn't request this? Safely ignore this email — nothing will change.`;
  const html =
`<div style="margin:0;padding:28px 12px;background:#050807;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#0d1117;border:1px solid #1f2a24;border-radius:16px;overflow:hidden;">
    <div style="background-color:#03140a;background-image:linear-gradient(135deg,#03140a,#0d1117);padding:18px 28px;border-bottom:1px solid #163021;">
      <span style="font-family:'Courier New',monospace;font-size:15px;color:#00ff41;font-weight:bold;letter-spacing:1px;">&gt;_ PORTFOLIO</span>
      <span style="font-family:'Courier New',monospace;font-size:11px;color:#3d5a48;float:right;">SECURE&nbsp;MAIL</span>
    </div>
    <div style="padding:30px 28px;color:#e6edf3;">
      <h2 style="margin:0 0 10px;font-size:20px;color:#e6edf3;">${heading}</h2>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#9fb0a5;">${who} ${intro}</p>
      <div style="background-color:#07160d;border:1px dashed #00ff41;border-radius:12px;padding:20px 16px;text-align:center;margin:0 0 20px;">
        <div style="font-family:'Courier New',monospace;font-size:38px;font-weight:bold;letter-spacing:12px;color:#ffa657;">${otp}</div>
        <div style="font-family:'Courier New',monospace;font-size:11px;color:#3d5a48;margin-top:10px;letter-spacing:3px;">ONE-TIME&nbsp;CODE</div>
      </div>
      <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#9fb0a5;">&#9201; This code is valid for <b style="color:#7ee787;">${validityMins} minutes</b>.</p>
      <p style="margin:0 0 22px;font-size:13px;line-height:1.6;color:#9fb0a5;">&#128274; Never share this code with anyone &mdash; we will never ask for it.</p>
      <div style="border-top:1px solid #163021;padding-top:14px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#56695e;">Didn't request this? You can safely ignore this email &mdash; your account is secure and nothing will change.</p>
      </div>
    </div>
    <div style="background-color:#080d0a;padding:12px 28px;text-align:center;border-top:1px solid #12241a;">
      <span style="font-family:'Courier New',monospace;font-size:11px;color:#3d5a48;">automated message &middot; do not reply</span>
    </div>
  </div>
</div>`;
  return { text, html };
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

module.exports = { sendMail, otpTemplate, mailReady: () => !!transporter };
