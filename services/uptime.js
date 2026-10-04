/**
 * Uptime monitor — "email me before / when the site goes down".
 *
 *  1. Health check every 5 min → GET <PROD_URL|localhost>/healthz
 *     - 2 consecutive failures → 🔴 "SITE DOWN" email (once)
 *     - recovery → 🟢 "SITE BACK UP" email (with downtime duration)
 *  2. Predictive warnings (before the site goes down):
 *     - Render free plan spins the service down after ~15 min idle.
 *       KEEP_ALIVE=true (default) self-pings every 10 min so it never sleeps.
 *       If keep-alive is disabled, an email warns before the expected spin-down.
 *     - Memory guard: RSS above MEM_ALERT_MB (default 450) → warning email.
 *
 * Status is exposed to the admin panel via status().
 */
const http = require('http');
const https = require('https');
const { sendMail, mailReady } = require('./mailer');

const CHECK_EVERY = 5 * 60 * 1000;      // 5 min health check
const KEEPALIVE_EVERY = 10 * 60 * 1000; // 10 min < Render's 15-min idle spin-down
const IDLE_LIMIT = 14 * 60 * 1000;      // warn before spin-down when keep-alive off

const state = {
  enabled: false,
  target: '',
  lastCheckedAt: null,
  lastStatus: null, // true=up, false=down, null=unknown
  lastLatencyMs: null,
  lastError: '',
  fails: 0,
  downSince: null,
  notifiedDown: false,
  lastIdleEmailAt: 0,
  lastMemEmailAt: 0,
  keepAlive: String(process.env.KEEP_ALIVE ?? 'true').toLowerCase() !== 'false',
  lastKeepAliveAt: null,
};

function fetchOnce(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'Portfolio-KeepAlive/1.0' } }, (res) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 500, status: res.statusCode, ms: Date.now() - t0 });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, ms: Date.now() - t0, err: 'timeout' }); });
      req.on('error', (e) => resolve({ ok: false, status: 0, ms: Date.now() - t0, err: e.message }));
    } catch (e) {
      resolve({ ok: false, status: 0, ms: Date.now() - t0, err: e.message });
    }
  });
}

async function alert(subject, lines) {
  const to = process.env.ALERT_EMAIL || process.env.ADMIN_EMAIL;
  if (!to) return;
  await sendMail({
    to,
    subject,
    text: lines.join('\n'),
    html: lines.map((l) => `<p>${l}</p>`).join(''),
  });
}

async function healthCheck() {
  if (!state.target) return;
  const r = await fetchOnce(state.target + '/healthz');
  state.lastCheckedAt = new Date();
  state.lastStatus = r.ok;
  state.lastLatencyMs = r.ms;
  state.lastError = r.err || (r.ok ? '' : `HTTP ${r.status}`);

  if (!r.ok) {
    state.fails++;
    if (state.fails >= 2 && !state.notifiedDown) {
      state.notifiedDown = true;
      state.downSince = new Date();
      await alert('🔴 SITE DOWN — Portfolio', [
        '<b>Your portfolio site is DOWN.</b>',
        `Checked: ${state.target}/healthz`,
        `Error: ${state.lastError || 'no response'}`,
        `Failed checks: ${state.fails}`,
        `Time: ${new Date().toLocaleString('en-IN')}`,
        'Render dashboard → check deploy logs / restart the service.',
      ]);
      console.error('[UPTIME] 🔴 site DOWN — alert email sent');
    }
  } else {
    if (state.notifiedDown) {
      const mins = state.downSince ? Math.round((Date.now() - state.downSince) / 60000) : '?';
      await alert('🟢 SITE BACK UP — Portfolio', [
        '<b>Your portfolio site is back UP.</b>',
        `Downtime: ~${mins} minute(s)`,
        `Recovered: ${new Date().toLocaleString('en-IN')}`,
      ]);
      console.log('[UPTIME] 🟢 site back UP — recovery email sent');
    }
    state.fails = 0;
    state.notifiedDown = false;
    state.downSince = null;
  }
}

// predictive: warn before Render spins the site down (only when keep-alive off)
async function idleWatch() {
  if (state.keepAlive || !state.enabled) return;
  const idleFor = Date.now() - lastRequestAt;
  if (idleFor > IDLE_LIMIT && Date.now() - state.lastIdleEmailAt > 60 * 60 * 1000) {
    state.lastIdleEmailAt = Date.now();
    await alert('🟠 SITE ABOUT TO SLEEP — Portfolio', [
      '<b>The site will sleep (spin down) in ~15 minutes — no incoming traffic.</b>',
      'The next visitor will wait 30-60 seconds on the first request (cold start).',
      'To prevent this, set KEEP_ALIVE=true in the environment (recommended).',
    ]);
  }
}

// predictive: memory pressure → warning before a crash/down event
async function memoryWatch() {
  if (!state.enabled) return;
  const limitMb = parseInt(process.env.MEM_ALERT_MB, 10) || 450;
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (rssMb > limitMb && Date.now() - state.lastMemEmailAt > 60 * 60 * 1000) {
    state.lastMemEmailAt = Date.now();
    await alert('🟠 MEMORY HIGH — Portfolio', [
      `<b>Memory ${rssMb}MB — above the ${limitMb}MB limit. Risk of process crash/downtime.</b>`,
      'Check for heavy traffic or a leak; a Render plan upgrade is also an option.',
    ]);
  }
}

let lastRequestAt = Date.now();
function touch() { lastRequestAt = Date.now(); }

function start() {
  const prod = String(process.env.PROD_URL || '').replace(/\/+$/, '');
  const port = process.env.PORT || 3000;
  state.target = prod || `http://127.0.0.1:${port}`;
  state.enabled = true;

  if (prod) {
    setInterval(async () => {
      if (state.keepAlive) {
        const r = await fetchOnce(prod + '/');
        state.lastKeepAliveAt = new Date();
        if (!r.ok) console.warn('[KEEP-ALIVE] ping failed:', r.err || r.status);
      }
    }, KEEPALIVE_EVERY).unref();
    // immediate first ping so a fresh deploy registers as "active"
    if (state.keepAlive) fetchOnce(prod + '/').then(() => { state.lastKeepAliveAt = new Date(); });
  }

  setInterval(healthCheck, CHECK_EVERY).unref();
  setTimeout(healthCheck, 15 * 1000).unref(); // first check 15s after boot
  setInterval(idleWatch, CHECK_EVERY).unref();
  setInterval(memoryWatch, CHECK_EVERY).unref();

  console.log(`[UPTIME] monitoring ${state.target} every ${CHECK_EVERY / 60000} min (keep-alive: ${state.keepAlive ? 'ON' : 'OFF'}, email alerts: ${mailReady() ? 'ON' : 'OFF — set SMTP_PASS'})`);
}

function status() {
  return {
    enabled: state.enabled,
    target: state.target,
    lastCheckedAt: state.lastCheckedAt,
    lastStatus: state.lastStatus,
    lastLatencyMs: state.lastLatencyMs,
    lastError: state.lastError,
    fails: state.fails,
    keepAlive: state.keepAlive,
    lastKeepAliveAt: state.lastKeepAliveAt,
    alertsTo: process.env.ALERT_EMAIL || process.env.ADMIN_EMAIL || '',
    mailReady: mailReady(),
  };
}

module.exports = { start, status, touch };
