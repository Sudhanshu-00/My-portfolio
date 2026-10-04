/**
 * Security service — visitor/tester intelligence + IP blocking.
 *
 *   recorder  → logs every non-static request (IP, device, location, path, status)
 *   guard     → 403s blocked IPs before anything else runs
 *   blockIp() → persistent block (visible in Admin → Security, unblockable)
 *
 * Logs auto-delete after 30 days (TTL index on SecurityEvent).
 * Geo: ip-api.com free endpoint (40 lookups/min, cached forever in memory,
 * results back-filled onto all events of that IP). Never blocks the request —
 * lookups are async fire-and-forget.
 */
const http = require('http');
const { SecurityEvent, BlockedIp } = require('../models');
const ADMIN_PATH = require('../adminPath');
const { sendMail } = require('./mailer');

// ---------- small helpers ----------
// normalize IPv4-mapped IPv6 (::ffff:1.2.3.4 → 1.2.3.4)
const normIp = (ip) => {
  const s = String(ip || '').trim();
  const m = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return m ? m[1] : s;
};

const isPrivateIp = (rawIp) => {
  const ip = normIp(rawIp);
  return (
    !ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') ||
    ip.startsWith('192.168.') || ip.startsWith('169.254.') || ip.startsWith('fc') || ip.startsWith('fd') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || ip.startsWith('::ffff:127.')
  );
};

const isIp = (rawV) => {
  const v = normIp(rawV);
  return /^(?:\d{1,3}(?:\.\d{1,3}){3})$/.test(v) || (/^[a-f0-9:]{2,45}$/i.test(v) && v.includes(':'));
};

const maskPath = (p) => {
  const s = String(p || '');
  return s === '/' + ADMIN_PATH || s.startsWith('/' + ADMIN_PATH + '/') ? s.replace('/' + ADMIN_PATH, '/[panel]') : s;
};

// ---------- device / tool parsing (no dependency) ----------
const TOOL_SIGS = ['curl/', 'wget', 'python-requests', 'python-urllib', 'aiohttp', 'go-http-client', 'java/', 'apache-httpclient', 'libwww', 'okhttp', 'dirsearch', 'dirb', 'nikto', 'nmap', 'masscan', 'sqlmap', 'gobuster', 'feroxbuster', 'wfuzz', 'ffuf', 'burp', 'owasp zap', 'hydra', 'wpscan', 'whatweb', 'nuclei', 'dalfox', 'arjun', 'httpx', 'openvas', 'acunetix', 'nessus'];
const BOTS = ['bot', 'spider', 'crawl', 'slurp', 'headless', 'preview', 'monitor'];

function parseDevice(ua) {
  ua = String(ua || '');
  const l = ua.toLowerCase();
  const tool = TOOL_SIGS.find((t) => l.includes(t));
  if (tool) return { browser: ua.split(/[ /]/)[0].slice(0, 30) || tool, os: 'unknown', devType: 'Tool' };
  if (BOTS.some((b) => l.includes(b))) return { browser: 'Bot', os: 'unknown', devType: 'Bot' };
  let browser = 'Unknown';
  if (l.includes('edg/')) browser = 'Edge';
  else if (l.includes('opr/') || l.includes('opera')) browser = 'Opera';
  else if (l.includes('chrome')) browser = 'Chrome';
  else if (l.includes('firefox')) browser = 'Firefox';
  else if (l.includes('safari')) browser = 'Safari';
  let os = 'Unknown';
  if (l.includes('windows')) os = 'Windows';
  else if (l.includes('android')) os = 'Android';
  else if (l.includes('iphone') || l.includes('ipad')) os = 'iOS';
  else if (l.includes('mac os')) os = 'macOS';
  else if (l.includes('linux')) os = 'Linux';
  const devType = l.includes('mobile') || l.includes('android') || l.includes('iphone') ? 'Mobile' : 'Desktop';
  return { browser, os, devType };
}

// ---------- geo lookup (ip-api.com, cached, throttled 40/min) ----------
const geoCache = new Map(); // ip → { city, region, country }
let geoQueue = [];
let geoSentThisMin = 0;
setInterval(() => { geoSentThisMin = 0; pumpGeo(); }, 60 * 1000).unref();

function pumpGeo() {
  while (geoQueue.length && geoSentThisMin < 40) {
    const { ip } = geoQueue.shift();
    geoSentThisMin++;
    http.get(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city`, { timeout: 6000 }, (r) => {
      let raw = '';
      r.on('data', (c) => (raw += c));
      r.on('end', () => {
        try {
          const j = JSON.parse(raw);
          const geo = { city: String(j.city || '').slice(0, 60), region: String(j.regionName || '').slice(0, 60), country: String(j.country || '').slice(0, 60) };
          geoCache.set(ip, geo);
          // back-fill every event of this IP that is still missing a location
          SecurityEvent.updateMany({ ip, country: '' }, { $set: geo }).catch(() => {});
        } catch { /* ignore bad responses */ }
      });
    }).on('error', () => {});
  }
}

function attachGeo(ip, isPrivate) {
  if (isPrivate || !isIp(ip)) {
    SecurityEvent.updateMany({ ip, country: '' }, { $set: { country: 'Local/Private network' } }).catch(() => {});
    return;
  }
  if (geoCache.has(ip)) {
    const geo = geoCache.get(ip);
    SecurityEvent.updateMany({ ip, country: '' }, { $set: geo }).catch(() => {});
    return;
  }
  if (!geoQueue.some((q) => q.ip === ip)) geoQueue.push({ ip });
  pumpGeo();
}

// ---------- event writer ----------
function logEvent(req, extra = {}) {
  try {
    const ua = String((req && req.headers && req.headers['user-agent']) || '').slice(0, 200);
    const ip = normIp((req && req.ip) || '').slice(0, 45);
    const dev = parseDevice(ua);
    const isPrivate = isPrivateIp(ip);
    const doc = {
      ip, ua,
      method: String(extra.method || (req && req.method) || '').slice(0, 8),
      path: maskPath(extra.path ?? (req ? req.path : '')).slice(0, 200),
      status: Number(extra.status || 0) || 0,
      device: `${dev.browser} · ${dev.os} · ${dev.devType}`,
      browser: dev.browser, os: dev.os, devType: dev.devType,
      reason: extra.reason || 'visit',
      severity: extra.severity || 'info',
    };
    const p = SecurityEvent.create(doc);
    p.then(() => attachGeo(ip, isPrivate)).catch(() => {});
  } catch { /* logging must never break a request */ }
}

// ---------- blocked IP registry (memory cache + Mongo) ----------
const blockedCache = new Map(); // ip → { until, reason }

async function loadBlocked() {
  try {
    const docs = await BlockedIp.find().lean();
    blockedCache.clear();
    for (const d of docs) {
      if (!d.until || d.until > new Date()) blockedCache.set(d.ip, { until: d.until, reason: d.reason });
    }
  } catch { /* keep old cache */ }
}

async function blockIp(rawIp, reason, ms = 0, auto = true) {
  const ip = normIp(rawIp);
  if (!isIp(ip) || isPrivateIp(ip)) return false; // never lock yourself out of localhost
  const until = ms > 0 ? new Date(Date.now() + ms) : null;
  blockedCache.set(ip, { until, reason });
  await BlockedIp.updateOne({ ip }, { ip, reason: String(reason).slice(0, 200), until, auto }, { upsert: true }).catch(() => {});
  return true;
}

async function unblockIp(rawIp) {
  const ip = normIp(rawIp);
  blockedCache.delete(ip);
  await BlockedIp.deleteOne({ ip }).catch(() => {});
}

// periodic refresh → picks up TTL auto-unblocks + manual changes
setInterval(loadBlocked, 60 * 1000).unref();
loadBlocked();

// ---------- auto-block counters (sliding window, in-memory) ----------
const counters = new Map(); // ip → { kind → [timestamps] }
setInterval(() => counters.clear(), 30 * 60 * 1000).unref();

const RULES = {
  notFound: { limit: 30, windowMs: 10 * 60 * 1000, blockMs: 60 * 60 * 1000, reason: '404 fuzzing (dirsearch/gobuster-style scan)' },
  suspicious: { limit: 10, windowMs: 10 * 60 * 1000, blockMs: 24 * 60 * 60 * 1000, reason: 'Security probing (sensitive paths)' },
  loginFail: { limit: 8, windowMs: 15 * 60 * 1000, blockMs: 60 * 60 * 1000, reason: 'Brute-force login attempts' },
};

// max 1 alert email per 30 min per kind (no spam during long scans)
const lastAlert = new Map();
async function alertEmail(kind, ip, detail) {
  const now = Date.now();
  if (now - (lastAlert.get(kind) || 0) < 30 * 60 * 1000) return;
  lastAlert.set(kind, now);
  const to = process.env.ALERT_EMAIL || process.env.ADMIN_EMAIL;
  if (!to) return;
  await sendMail({
    to,
    subject: `🛡 Portfolio security — IP blocked (${ip})`,
    text: `Auto-defence blocked an IP.\n\nIP: ${ip}\nReason: ${detail}\n\nManage it in Admin Panel → Security (you can unblock there).`,
    html: `<p><b>Auto-defence blocked an IP.</b></p><p>IP: <code>${ip}</code><br>Reason: ${detail}</p><p>Manage in Admin Panel → Security (unblock available).</p>`,
  });
}

function bump(req, kind, status = 0) {
  const rule = RULES[kind];
  if (!rule) return;
  const now = Date.now();
  const ip = normIp(req.ip);
  const rec = counters.get(ip) || {};
  const arr = (rec[kind] || []).filter((t) => now - t < rule.windowMs);
  arr.push(now);
  rec[kind] = arr;
  counters.set(ip, rec);
  if (arr.length > rule.limit) {
    counters.get(ip)[kind] = [];
    blockIp(ip, rule.reason, rule.blockMs, true).then((okFlag) => {
      if (okFlag) {
        logEvent(req, { reason: 'auto-block', severity: 'high', status, path: req.path });
        alertEmail(kind, ip, `${rule.reason} — ${arr.length} hits in ${Math.round(rule.windowMs / 60000)} min`);
        console.warn(`[BLOCK] ${ip} auto-blocked for ${rule.blockMs / 60000} min — ${rule.reason}`);
      }
    });
  }
}

// ---------- suspicious paths (probes for files/famous panels) ----------
const SUSPICIOUS = /(\.env($|[./])|\.git|\.aws|\.ssh|wp-|phpmyadmin|xmlrpc|\/admin|adminer|\.sql|\.bak$|\.zip$|\.tar$|backup|config\.json|web\.config|actuator|cgi-bin|\.php|\.asp$|\.jsp$|\.aspx$|\/etc\/passwd|\.htaccess)/i;

// ---------- middleware ----------
// 1) guard — blocked IPs get a fast 403, nothing else runs
function guard(req, res, next) {
  const b = blockedCache.get(normIp(req.ip));
  if (b && (!b.until || b.until > new Date())) {
    res.set('Retry-After', b.until ? Math.ceil((b.until - Date.now()) / 1000) : 86400);
    // log at most 1 line/min/IP so a hammering blocked IP doesn't flood the DB
    const now = Date.now();
    const last = logThrottle.get(req.ip) || 0;
    if (now - last > 60 * 1000) {
      logThrottle.set(req.ip, now);
      logEvent(req, { reason: 'blocked-request', severity: 'high', status: 403, path: req.path });
    }
    return res.status(403).send('Access denied — your IP has been blocked.');
  }
  next();
}
const logThrottle = new Map();
setInterval(() => logThrottle.clear(), 10 * 60 * 1000).unref();

// 2) recorder — logs every non-static request with device + status
const STATIC_SKIP = /^\/(css|js|images|img|fonts)\//i;
const FILE_SKIP = /\.(png|jpe?g|gif|svg|ico|webp|avif|css|js|map|txt|xml|woff2?|ttf|otf|mp4|pdf)$/i;

function recorder(req, res, next) {
  const p = req.path;
  if (p === '/healthz' || STATIC_SKIP.test(p) || FILE_SKIP.test(p)) return next();
  res.on('finish', () => {
    const status = res.statusCode;
    let reason = 'visit', severity = 'info';
    if (status === 429) { reason = 'rate-limit'; severity = 'medium'; }
    else if (status === 403) { reason = 'blocked-request'; severity = 'high'; }
    else if (!p.startsWith('/user/') && SUSPICIOUS.test(p)) { // /user/<name>/admin/login is the legit gated route
      reason = 'suspicious-path'; severity = 'high';
      bump(req, 'suspicious', status);
    } else if (status === 404) {
      reason = 'not-found'; severity = 'low';
      bump(req, 'notFound', status);
    }
    logEvent(req, { reason, severity, status, path: p });
  });
  next();
}

module.exports = {
  guard, recorder, logEvent,
  blockIp, unblockIp, loadBlocked, normIp,
  bump, isIp, isPrivateIp, maskPath, parseDevice,
  blockedCount: () => blockedCache.size,
};
