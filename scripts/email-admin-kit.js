/**
 * Admin Kit — .env backup + admin URLs → email pe.
 *
 * Ek baar bhejo:      node scripts/email-admin-kit.js
 * Auto-update mode:   node scripts/email-admin-kit.js --watch
 *                     (.env badalne pe khud email chala jayega — chalaye raho)
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
    <p style="color:#ccc">⚠️ Is email ko delete/forward mat karna — isme secrets hain.</p>
    <h3 style="color:#00ff41">📍 Admin URLs</h3>
    <table style="color:#ccc;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:4px 12px 4px 0">Admin Panel (secret)</td><td><b>${PROD}/${P}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Admin Login</td><td><b>${PROD}/${P}/login/adminlogin</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Normal Login</td><td><b>${PROD}/login</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Local Panel</td><td>${LOCAL}/${P}</td></tr>
      <tr><td style="padding:4px 12px 4px 0">Username</td><td><b>${process.env.ADMIN_USER || 'admin'}</b></td></tr>
      <tr><td style="padding:4px 12px 4px 0">Password</td><td><b>${process.env.ADMIN_PASS || '(see .env)'}</b></td></tr>
    </table>
    <p style="color:#ffb703">Password: .env backup me hai (neeche ADMIN_PASS) — strong password laga zaroor!</p>
    <h3 style="color:#00ff41">💾 .env Backup (${new Date().toLocaleString('en-IN')})</h3>
    <pre style="background:#111;padding:14px;border:1px solid #333;border-radius:8px;color:#aaa;font-size:12px;white-space:pre-wrap">${envEscaped}</pre>
    <p style="color:#666;font-size:12px">Naye device pe: clone → npm install → is content se .env banao → node server.js</p>
  </div>`;
}

async function send(reason) {
  const env = fs.readFileSync(ENV_PATH, 'utf8');
  const hash = crypto.createHash('sha256').update(env).digest('hex');
  if (hash === lastHash) return; // koi change nahi — skip
  lastHash = hash;
  const ok = await sendMail({
    to: process.env.ADMIN_EMAIL,
    subject: `🔐 Portfolio Admin Kit — .env backup (${reason})`,
    html: buildHtml(env),
  });
  console.log(ok ? `✅ Admin kit email bheja (${reason})` : '❌ Email fail');
}

(async () => {
  if (!mailReady()) {
    console.error('SMTP configured nahi hai — .env me SMTP_PASS bharo.');
    process.exit(1);
  }
  if (!P) console.warn('⚠️ ADMIN_PATH .env me nahi hai — email me secret path khali rahega.');

  await send('manual');

  if (process.argv.includes('--watch')) {
    console.log('👀 Watch mode ON — .env badloge to email apne aap jayega (Ctrl+C to stop)');
    fs.watch(ENV_PATH, () => {
      clearTimeout(send._t);
      send._t = setTimeout(() => send('auto-update'), 5000); // debounce 5s
    });
  }
})();
