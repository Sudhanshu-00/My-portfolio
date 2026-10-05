/**
 * Mailer — Brevo HTTPS API (if BREVO_API_KEY is set) with Gmail SMTP fallback
 * (creds from env, no hardcoded secrets).
 * SMTP_PASS = Gmail "App Password" (requires 2FA, 16-char).
 * If neither is configured → DEV fallback: OTP is logged to the server console.
 */
const nodemailer = require('nodemailer');

// Cloud hosts (e.g. Render) often have no working outbound IPv6 route while
// Node ≥17 prefers AAAA records — the SMTP connect then silently hangs.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch (_) { /* older Node */ }

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

// From identity — MAIL_FROM env (e.g. `Portfolio <noreply.portfolio@gmail.com>`).
// Personal Gmail + Google avatar dono chhupe rehte hain — OTP mails brand ke naam se jaate hain.
// Format: `Name <email>` ya sirf `<email>`. Unset → old behaviour (SMTP_USER se).
const _fm = (process.env.MAIL_FROM || '').match(/^\s*(.*?)\s*<\s*([^>\s]+)\s*>\s*$/);
const FROM_NAME = _fm ? _fm[1] || 'Portfolio' : 'Portfolio Admin';
const FROM_EMAIL = _fm ? _fm[2] : SMTP_USER;
// Brevo API primary. Gmail SMTP fallback sirf tab jab From == SMTP auth user —
// warna Gmail reject/rewrite karta hai aur purana personal email leak ho jata.
const BREVO_ONLY = !!(FROM_EMAIL && SMTP_USER && FROM_EMAIL !== SMTP_USER);

function makeTransport(port, secure) {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    // one pooled connection reused across emails — repeated fresh SMTP
    // logins from a datacenter IP get tarpitted by Gmail
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    // hard ceilings so a stalled SMTP connection can never hang a request
    connectionTimeout: 10_000, // TCP connect
    greetingTimeout: 10_000,   // EHLO banner
    socketTimeout: 20_000,     // idle/stalled socket
    dnsTimeout: 5_000,
  });
}

// Gmail accepts both 465 (implicit TLS) and 587 (STARTTLS) — cloud hosts
// sometimes get one path throttled, so we keep a fallback transport.
const primaryPort = parseInt(process.env.SMTP_PORT, 10) || 465;
const fallbackPort = primaryPort === 465 ? 587 : 465;
const transports = (SMTP_USER && SMTP_PASS)
  ? [
      { tr: makeTransport(primaryPort, primaryPort === 465), label: `smtp:${primaryPort}` },
      { tr: makeTransport(fallbackPort, fallbackPort === 465), label: `smtp:${fallbackPort}` },
    ]
  : [];

// Brevo HTTPS API transport — runs over port 443, immune to SMTP-port/IP
// throttling that cloud egress IPs (Render free tier) suffer from Gmail.
// Sender must be a verified sender in the Brevo account (SMTP_USER).
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';

async function sendViaBrevo({ to, subject, text, html }) {
  const body = JSON.stringify({
    sender: { name: FROM_NAME, email: FROM_EMAIL },
    to: [{ email: to }],
    subject,
    textContent: text,
    htmlContent: html,
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (r.status === 201) return true;
      console.error(`Brevo API error (attempt ${attempt}/2): HTTP ${r.status}`, (await r.text()).slice(0, 200));
    } catch (e) {
      console.error(`Brevo API error (attempt ${attempt}/2):`, e.message);
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
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
  if (BREVO_API_KEY && (await sendViaBrevo({ to, subject, text, html }))) return true;
  if (BREVO_ONLY) {
    // From identity SMTP auth se alag hai — Gmail fallback bhejega to personal
    // address hi dikhega/reject hoga. Brevo hi single source of truth.
    console.error('Brevo API failed and SMTP fallback disabled (MAIL_FROM ≠ SMTP_USER) — mail not sent');
    return false;
  }
  if (!transports.length) {
    if (!BREVO_API_KEY) {
      console.warn('⚠️  SMTP not configured (set SMTP_PASS in .env) — DEV fallback, email was NOT sent:');
      console.warn(`   to=${to} subject=${subject}`);
    }
    return false;
  }
  const mail = { from: `"${FROM_NAME}" <${FROM_EMAIL}>`, to, subject, text, html };
  for (const { tr, label } of transports) {
    try {
      await tr.sendMail(mail);
      return true;
    } catch (e) {
      console.error(`Mail error via ${label}:`, e.message);
    }
  }
  return false;
}

/**
 * Seed credentials email — jab fresh install par random admin/owner password
 * generate hota hai (env me password set nahi tha), to username+password isi
 * email me owner (ADMIN_EMAIL) ko bheje jaate hain — console me sirf fallback.
 * Sirf RANDOM-generated passwords ke liye use hota hai; env-set passwords
 * kabhi email nahi hote.
 */
function credentialsTemplate({ username, password, context }) {
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  const text =
    `Portfolio — account credentials (first-time setup)\n\n` +
    `Context : ${context}\n` +
    `Username: ${username}\n` +
    `Password: ${password}\n\n` +
    `⚠ Change this password immediately after first login.\n` +
    `This password was auto-generated because none was configured in env.\n`;
  const html =
`<div style="margin:0;padding:28px 12px;background:#050807;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#0d1117;border:1px solid #1f2a24;border-radius:16px;overflow:hidden;">
    <div style="background-color:#03140a;background-image:linear-gradient(135deg,#03140a,#0d1117);padding:18px 28px;border-bottom:1px solid #163021;">
      <span style="font-family:'Courier New',monospace;font-size:15px;color:#00ff41;font-weight:bold;letter-spacing:1px;">&gt;_ PORTFOLIO</span>
      <span style="font-family:'Courier New',monospace;font-size:11px;color:#3d5a48;float:right;">FIRST-TIME&nbsp;SETUP</span>
    </div>
    <div style="padding:30px 28px;color:#e6edf3;">
      <h2 style="margin:0 0 10px;font-size:20px;color:#e6edf3;">🔐 Account credentials</h2>
      <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#9fb0a5;">A new account was auto-created (${esc(context)}). Credentials below — <b style="color:#ffa657;">change the password immediately after first login</b>.</p>
      <div style="background-color:#07160d;border:1px dashed #00ff41;border-radius:12px;padding:18px 16px;margin:0 0 20px;">
        <div style="font-family:'Courier New',monospace;font-size:13px;color:#9fb0a5;">USERNAME</div>
        <div style="font-family:'Courier New',monospace;font-size:20px;font-weight:bold;color:#7ee787;margin:4px 0 14px;">${esc(username)}</div>
        <div style="font-family:'Courier New',monospace;font-size:13px;color:#9fb0a5;">PASSWORD</div>
        <div style="font-family:'Courier New',monospace;font-size:20px;font-weight:bold;color:#ffa657;word-break:break-all;margin-top:4px;">${esc(password)}</div>
      </div>
      <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#9fb0a5;">&#9888; This password was auto-generated because none was set in the environment (ADMIN_PASS / OWNER_PASS).</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#9fb0a5;">&#128274; Set the password in env to control it yourself on future seeds.</p>
    </div>
    <div style="background-color:#080d0a;padding:12px 28px;text-align:center;border-top:1px solid #12241a;">
      <span style="font-family:'Courier New',monospace;font-size:11px;color:#3d5a48;">one-time setup email &middot; delete after saving credentials</span>
    </div>
  </div>
</div>`;
  return { text, html };
}

async function sendCredentials({ to, username, password, context }) {
  if (!to) return false;
  const { text, html } = credentialsTemplate({ username, password, context });
  return sendMail({ to, subject: '🔐 Portfolio — account credentials (change password after login)', text, html });
}

module.exports = { sendMail, otpTemplate, sendCredentials, mailReady: () => transports.length > 0 || !!BREVO_API_KEY };
