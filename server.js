require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const { initDB, getActiveUri } = require('./db');
const { SiteSetting, PageView } = require('./models');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

// Secret admin entrance — /admin publicly 404 dega, asli panel sirf
// ADMIN_PATH (env, .env me) se khulega. Path kisi HTML/JS me expose nahi hota.
const ADMIN_PATH = process.env.ADMIN_PATH || 'admin';
const SECRET_MOUNT = '/' + ADMIN_PATH;

async function main() {
  await initDB();

  const app = express();
  app.disable('x-powered-by'); // fingerprinting kam
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
    });
    // CSP — admin pages me inline script (settings helper) hai, public me nahi
    const isAdmin = req.path === SECRET_MOUNT || req.path.startsWith(SECRET_MOUNT + '/');
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'self'${isAdmin ? " 'unsafe-inline'" : ''}`,
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
    next();
  });

  // ---------- global rate limit + IP auto-block ----------
  // 300 req/min per IP — cross karne pe 5 min ke liye block. (DoS/fuzzing shield)
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
      console.warn(`⛔ IP blocked (rate limit): ${req.ip}`);
      return res.status(429).send('Too many requests — IP temporarily blocked.');
    }
    rateMap.set(req.ip, r);
    next();
  });

  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  app.use(
    session({
      name: 'hsid', // default connect.sid fingerprint hatao
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
  // Panel: sirf secret path (ADMIN_PATH) — /admin/* publicly 404.
  // /login, /forgot, /reset public aliases — taaki site se login + email-OTP recovery ho sake
  // aur secret path kabhi public HTML me leak na ho.
  const AUTH_PATHS = ['/login', '/login/adminlogin', '/forgot', '/forgot/verify', '/reset'];
  app.use((req, res, next) => {
    res.locals.adminBase = SECRET_MOUNT; // views me saare admin links isse bante hain
    if (req.url === SECRET_MOUNT || req.url.startsWith(SECRET_MOUNT + '/')) {
      req.url = req.url.slice(SECRET_MOUNT.length) || '/';
      return adminRoutes(req, res, next);
    }
    if (AUTH_PATHS.includes(req.path)) {
      // req.url already relative (/login) — router direct match karega
      return adminRoutes(req, res, next);
    }
    next();
  });

  // Page view analytics (public pages only — admin rewrite ho chuka hai, /admin skip works)
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/admin')) {
      PageView.create({ path: req.path }).catch(() => {});
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

  // Error handler — stack leak nahi
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).send('Something went wrong. Please try again.');
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`🚀 Portfolio running → http://localhost:${port}`));
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
