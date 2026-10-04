require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const { initDB, getActiveUri } = require('./db');
const { SiteSetting, PageView } = require('./models');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const security = require('./services/security');
const uptime = require('./services/uptime');

// Secret admin entrance — the real panel only opens on ADMIN_PATH.
// Path resolution (with fail-closed random fallback) lives in ./adminPath.js —
// single source of truth shared with routes/admin.js. Never exposed in HTML/JS.
const ADMIN_PATH = require('./adminPath');
const SECRET_MOUNT = '/' + ADMIN_PATH;

async function main() {
  await initDB();

  const app = express();
  app.disable('x-powered-by'); // reduce fingerprinting
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // ---------- security headers ----------
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Permitted-Cross-Domain-Policies': 'none',
    });
    if (process.env.NODE_ENV === 'production') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // CSP — all scripts served from /js (no inline JS anywhere, public or admin)
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; ')
    );
    // Never cache authenticated / auth pages — proxies (Burp etc.) must not store them
    if (req.path.startsWith(SECRET_MOUNT) || req.path.startsWith('/login') ||
        req.path.startsWith('/forgot') || req.path.startsWith('/reset') || req.path.startsWith('/signup')) {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.set('Pragma', 'no-cache');
    }
    next();
  });

  // ---------- health endpoint (uptime monitor pings this; excluded from all logs) ----------
  app.get('/healthz', (req, res) => res.json({ ok: true, uptime: Math.round(process.uptime()) }));

  // ---------- security recorder (visitor/tester logs) ----------
  // logs every non-static request → Admin → Security (IP, device, location, path, status).
  // (guard for blocked IPs runs after session — see below — so an admin is never locked out)
  app.use(security.recorder);
  app.use((req, res, next) => { uptime.touch(); next(); }); // last-activity tracking for idle alerts

  // ---------- global rate limit + IP auto-block ----------
  // 300 req/min per IP — exceeding it blocks the IP for 5 min. (DoS / fuzzing shield)
  const RL_LIMIT = 300, RL_WINDOW = 60_000, RL_BLOCK = 5 * 60_000;
  const rateMap = new Map();
  setInterval(() => rateMap.clear(), 10 * 60 * 1000).unref();
  app.use((req, res, next) => {
    const now = Date.now();
    const r = rateMap.get(req.ip) || { count: 0, win: now, blockedUntil: 0 };
    if (r.blockedUntil > now) {
      res.set('Retry-After', Math.ceil((r.blockedUntil - now) / 1000));
      return res.status(429).send('Too many requests — IP temporarily blocked.');
    }
    if (now - r.win > RL_WINDOW) { r.count = 0; r.win = now; }
    r.count++;
    if (r.count > RL_LIMIT) {
      r.blockedUntil = now + RL_BLOCK;
      // persistent block → shows up in Admin → Security (unblockable), survives restarts
      security.blockIp(req.ip, 'Rate limit exceeded (300 req/min)', RL_BLOCK, true);
      security.logEvent(req, { reason: 'rate-limit', severity: 'medium', status: 429, path: req.path });
      console.warn(`[BLOCK] IP blocked (rate limit exceeded): ${req.ip}`);
      return res.status(429).send('Too many requests — IP temporarily blocked.');
    }
    rateMap.set(req.ip, r);
    if (process.env.RATE_DEBUG) console.log("[RATE]", req.ip, r.count, "blockedUntil:", r.blockedUntil > 0);
    next();
  });

  // extended:false → `username[$gt]=` style payloads stay literal strings (NoSQLi-safe),
  // never become MongoDB operator objects.
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '100kb' })); // JSON bodies parsed & size-capped

  // ---------- injection sanitizer (defense in depth) ----------
  // Strip any key that could carry MongoDB operators ($-prefixed or dotted)
  // from body/query/params, and force values to stay plain strings/numbers.
  const clean = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;
    for (const k of Object.keys(obj)) {
      if (k.startsWith('$') || k.includes('.') || k.includes('[')) delete obj[k];
      else if (obj[k] && typeof obj[k] === 'object') clean(obj[k]);
    }
    return obj;
  };
  app.use((req, res, next) => {
    clean(req.body);
    clean(req.params);
    next();
  });

  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore', maxAge: '1d' }));

  app.use(
    session({
      name: 'hsid', // hide the default connect.sid fingerprint
      secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      store: MongoStore.create({ mongoUrl: getActiveUri(), collectionName: 'sessions' }),
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 1000 * 60 * 60 * 24, // 1 day
      },
    })
  );

  // Logged-in identity available in every view (normal user &/or admin)
  app.use((req, res, next) => {
    if (req.session) {
      if (req.session.user) res.locals.sessionUser = req.session.user;
      if (req.session.admin) res.locals.sessionAdmin = req.session.admin;
    }
    next();
  });

  // ---------- security guard (blocked IPs → 403) ----------
  // placed AFTER session so a logged-in admin is exempt — if you block yourself
  // during your own testing, the panel still opens (unblock via Admin → Security).
  app.use((req, res, next) => {
    if (req.session && req.session.admin) return next();
    security.guard(req, res, next);
  });

  // Settings + query available in every view
  app.use((req, res, next) => {
    res.locals.query = req.query;
    next();
  });
  app.use(async (req, res, next) => {
    try {
      res.locals.settings = await SiteSetting.get();
    } catch (e) {
      res.locals.settings = {};
    }
    next();
  });

  // ---------- secret admin mount + public auth pages ----------
  // Panel: only the secret path (ADMIN_PATH) — /admin/* is always a public 404.
  // /login, /forgot, /reset are public aliases — so the site can offer login +
  // email-OTP recovery without ever leaking the secret path in public HTML.
  const AUTH_PATHS = ['/login', '/login/adminlogin', '/signup', '/forgot', '/forgot/verify', '/reset', '/logout'];
  app.use((req, res, next) => {
    res.locals.adminBase = SECRET_MOUNT; // all admin links in views are built from this
    if (req.url === SECRET_MOUNT || req.url.startsWith(SECRET_MOUNT + '/')) {
      req.url = req.url.slice(SECRET_MOUNT.length) || '/';
      return adminRoutes(req, res, next);
    }
    // '/signup/*' prefix — multi-step wizard ke sub-routes (start/verify/resend/complete/captcha)
    if (AUTH_PATHS.includes(req.path) || req.path.startsWith('/signup/')) {
      return adminRoutes(req, res, next);
    }
    next();
  });

  // User-tier routes (normal dashboard, gated admin login)
  app.use('/user', require('./routes/user'));

  // Page view analytics (public pages only — admin requests were rewritten above;
  // skip our own keep-alive pinger so it never pollutes analytics)
  app.use((req, res, next) => {
    const ownPing = String(req.headers['user-agent'] || '').includes('Portfolio-KeepAlive');
    if (req.method === 'GET' && !ownPing && !req.path.startsWith('/admin') && !req.path.startsWith('/user') && req.path !== '/healthz') {
      PageView.create({ path: String(req.path).slice(0, 200) }).catch(() => {});
    }
    next();
  });

  // Visitor counter for footer (total + today)
  app.use(async (req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/admin')) {
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const [total, today] = await Promise.all([
          PageView.countDocuments(),
          PageView.countDocuments({ createdAt: { $gte: todayStart } }),
        ]);
        res.locals.visits = { total, today };
      } catch {
        res.locals.visits = { total: 0, today: 0 };
      }
    }
    next();
  });

  app.use('/', publicRoutes);

  // 404
  app.use((req, res) => res.status(404).render('404'));

  // body-parser errors (malformed JSON etc.) → clean 400
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large' || err.status === 400) {
      return res.status(400).send('Bad request.');
    }
    next(err);
  });

  // Error handler — never leak stack traces
  app.use((err, req, res, next) => {
    console.error('[ERROR]', err.message);
    res.status(500).send('Something went wrong. Please try again.');
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[OK] Portfolio running → http://localhost:${port}`);
    console.log(`[RUN] NODE_ENV=${process.env.NODE_ENV || '(unset — set to production on hosting!)'}`);
    const { mailReady } = require('./services/mailer');
    console.log(mailReady()
      ? `[MAIL] SMTP configured (${process.env.SMTP_HOST || 'smtp.gmail.com'}) → OTP / alert emails will send`
      : '[MAIL] ⚠️ SMTP NOT configured — set SMTP_USER + SMTP_PASS (Gmail app password) in hosting env, OTP emails will FAIL');
    uptime.start(); // downtime email alerts + Render keep-alive (see services/uptime.js)
  });
}

main().catch((e) => {
  console.error('Failed to start:', e.message);
  process.exit(1);
});
