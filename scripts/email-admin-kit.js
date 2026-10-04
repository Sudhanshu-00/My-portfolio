/**
 * Admin Kit — .env backup + admin URLs → sent to email.
 *
 * Send once:         node scripts/email-admin-kit.js
 * Auto-update mode:  node scripts/email-admin-kit.js --watch
 *                    (emails automatically whenever .env changes — keep it running)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sendMail, mailReady } = require('../services/mailer');

const ENV_PATH = path.join(__dirname, '..', '.env');
const PROD = process.env.PROD_URL || 'https://my-portfolio-fp1g.onrender.com';
const LOCAL = 'http://localhost:3000';
const P = process.env.ADMIN_PATH || '';

let lastHash = '';

function buildHtml(env) {
  const envEscaped = env.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
  <div style="font-family:monospace;background:#0a0a0a;color:#00ff41;padding:24px;border-radius:10px">
    <h2 style="color:#00ff41">🔐 Portfolio Admin Kit</h2>
    <p style="color:#ccc">⚠️ Do not delete/forward this email — it contains secrets.</p>
    <h3 style="color:#00ff41">📍 Admin URLs</h3>
    <table style="color:#ccc;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:4px 12px 4px 0">Admin Panel (secret)</td><td><b>${PROD}/${P}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Admin Login</td><td><b>${PROD}/${P}/login/adminlogin</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Normal Login</td><td><b>${PROD}/login</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Local Panel</td><td>${LOCAL}/${P}</td></tr>
      <tr><td style="padding:4px 12px 4px 0">Username</td><td><b>${process.env.ADMIN_USER || 'admin'}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Password</td><td><b>${process.env.ADMIN_PASS || '(see .env)'}</b></td></tr>
    </table>
    <p style="color:#ffb703">Password: it's in the .env backup below (ADMIN_PASS) — make sure to use a strong password!</p>
    <h3 style="color:#00ff41">💾 .env Backup (${new Date().toLocaleString('en-IN')})</h3>
    <pre style="background:#111;padding:14px;border:1px solid #333;border-radius:8px;color:#aaa;font-size:12px;white-space:pre-wrap">${envEscaped}</pre>
    <p style="color:#666;font-size:12px">On a new device: clone → npm install → create .env from this content → node server.js</p>
  </div>`;
}

async function send(reason) {
  const env = fs.readFileSync(ENV_PATH, 'utf8');
  const hash = crypto.createHash('sha256').update(env).digest('hex');
  if (hash === lastHash) return; // no change — skip
  lastHash = hash;
  const ok = await sendMail({
    to: process.env.ADMIN_EMAIL,
    subject: `🔐 Portfolio Admin Kit — .env backup (${reason})`,
    html: buildHtml(env),
  });
  console.log(ok ? `✅ Admin kit email sent (${reason})` : '❌ Email failed');
}

(async () => {
  if (!mailReady()) {
    console.error('SMTP is not configured — set SMTP_PASS in .env.');
    process.exit(1);
  }
  if (!P) console.warn('⚠️ ADMIN_PATH is not set in .env — the secret path in the email will be empty.');

  await send('manual');

  if (process.argv.includes('--watch')) {
    console.log('👀 Watch mode ON — editing .env will trigger an email automatically (Ctrl+C to stop)');
    fs.watch(ENV_PATH, () => {
      clearTimeout(send._t);
      send._t = setTimeout(() => send('auto-update'), 5000); // debounce 5s
    });
  }
})();
