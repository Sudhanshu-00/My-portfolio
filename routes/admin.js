const router = require('express').Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { AdminUser, Project, Skill, Message, SiteSetting, Tool, PageView, Service, Testimonial, Experience, Lab, Feedback, SecurityEvent, BlockedIp } = require('../models');
const { sendMail, otpTemplate, mailReady } = require('../services/mailer');
const security = require('../services/security');

// Secret admin path — single source of truth in ../adminPath.js (fail-closed:
// guessable 'admin' fallback is impossible).
const ADMIN_PATH = require('../adminPath');
const go = (p) => '/' + ADMIN_PATH + String(p || '/').replace(/^\/admin(?=\/|\?|$)/, '');

// URL hardening: only http(s) allowed — javascript:/data: href XSS blocked.
const safeUrl = (u) => {
  const s = String(u || '').trim().slice(0, 500);
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
};

// Mongo ObjectId format check — invalid ids never reach the query layer.
const isId = (v) => /^[a-f\d]{24}$/i.test(String(v || ''));

// ---------- photo upload helper ----------
const IMG_MIME = /^image\/(png|jpe?g|gif|webp|avif)$/i; // strict whitelist (no svg/html)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => cb(null, IMG_MIME.test(file.mimetype)),
});
const toDataUrl = (f) => (f ? `data:${f.mimetype};base64,${f.buffer.toString('base64')}` : '');

// ---------- resume (PDF) upload helper ----------
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

// ---------- auth ----------
const crypto = require('crypto');
// timing-safe string compare (no early-exit timing oracle)
const safeEqual = (a, b) => {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const requireAuth = async (req, res, next) => {
  if (req.session.admin) {
    // ---- CSRF guard: verify token on every admin POST (blocks state-changing attacks) ----
    if (req.method === 'POST') {
      const token = req.body && req.body._csrf; // req.body may be undefined (empty POST)
      if (!req.session.csrf || !token || !safeEqual(req.session.csrf, token)) {
        return res.status(403).send('Security check failed — reload the page and try again.');
      }
    } else {
      // issue token on GET (passed to views via a hidden input)
      if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
      res.locals.csrf = req.session.csrf;
    }
    res.locals.admin = req.session.admin; // username for views
    res.locals.path = '/admin' + req.path; // sidebar active-state (router gives prefix-stripped path)
    res.locals.unread = await Message.countDocuments({ read: false });
    res.locals.mailReady = mailReady(); // sidebar 📧 badge — instantly shows if SMTP env is missing
    res.locals.pendingFeedback = await Feedback.countDocuments({ status: 'pending' });
    return next();
  }
  res.redirect(go('/login/adminlogin'));
};

// Validate every :id param — non-ObjectId input gets bounced (CastError/500 impossible)
router.param('id', (req, res, next, id) => {
  if (!isId(id)) return res.redirect(go('/admin/'));
  next();
});

router.get('/login', (req, res) => (req.session.admin ? res.redirect(go('/')) : res.render('admin/login', { error: null })));

// ---------- public signup (visitors can create their own account) ----------
// Reserved names — nobody can register 'sudhanshu'/'admin'-style usernames
// (only the real owner's user sees the admin-gate). Lowercase enforced.
const RESERVED = new Set(['sudhanshu', 'admin', 'administrator', 'root', 'mod', 'moderator', 'support', 'help', 'staff', 'official', 'system', 'security', 'api', 'signup', 'login', 'logout', 'user', 'users', 'me', 'profile', 'settings', 'reset', 'forgot', 'null', 'undefined']);
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const signupRate = new Map(); // ip → [timestamps]
setInterval(() => signupRate.clear(), 60 * 60 * 1000).unref();

const OTP_VALID_MS = 10 * 60 * 1000; // signup OTP 10 min valid
const OTP_MAX_ATTEMPTS = 5; // 5 wrong attempts → OTP dead
const OTP_RESEND_MIN_MS = 45 * 1000; // min gap between two sends
const OTP_MAX_SENDS = 4; // max 4 OTPs per signup session
const genOtp = () => String(require('crypto').randomInt(0, 1e6)).padStart(6, '0');

async function sendSignupOtp(email, username, otp) {
  const { text, html } = otpTemplate({
    heading: 'Email Verification',
    intro: `verify your email address to finish your signup. Enter this code on the verification page:`,
    otp,
    validityMins: 10,
    name: username,
  });
  const sent = await sendMail({
    to: email,
    subject: '🔐 Verification code — Portfolio signup', // OTP never in the subject
    text,
    html,
  });
  if (!sent && process.env.NODE_ENV !== 'production') console.log(`[DEV] signup OTP for ${username}: ${otp}`); // SMTP absent → dev console only
  return sent;
}

// captcha SVG — per-char rotation + noise lines/dots, confusing chars removed
function captchaSvg(text) {
  const W = 190, H = 62;
  const palette = ['#7ee787', '#79c0ff', '#ffa657', '#d2a8ff', '#ff7b72'];
  const glyphs = [...text].map((ch, i) => {
    const x = 25 + i * 31 + (Math.random() * 8 - 4);
    const y = 40 + (Math.random() * 10 - 5);
    const rot = Math.random() * 50 - 25;
    const fill = palette[Math.floor(Math.random() * palette.length)];
    const fs = 27 + Math.random() * 8;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${fill}" font-size="${fs.toFixed(1)}" font-family="monospace" font-weight="bold">${ch}</text>`;
  }).join('');
  const lines = Array.from({ length: 4 }, () => `<line x1="${(Math.random() * W).toFixed(0)}" y1="${(Math.random() * H).toFixed(0)}" x2="${(Math.random() * W).toFixed(0)}" y2="${(Math.random() * H).toFixed(0)}" stroke="${palette[Math.floor(Math.random() * palette.length)]}" stroke-width="1" opacity="0.5"/>`).join('');
  const dots = Array.from({ length: 40 }, () => `<circle cx="${(Math.random() * W).toFixed(0)}" cy="${(Math.random() * H).toFixed(0)}" r="1" fill="${palette[Math.floor(Math.random() * palette.length)]}" opacity="0.6"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0d1117" rx="8"/>${lines}${dots}${glyphs}</svg>`;
}

// ---------- 3-step signup wizard: (1) details → (2) email OTP → (3) password+captcha ----------
router.get('/signup', (req, res) => {
  if (req.session.user) return res.redirect(`/user/${encodeURIComponent(req.session.user)}`);
  const s = req.session.signup;
  if (s && s.verified) return res.render('signup', { step: 3, error: null, info: null, values: s }); // wizard resume
  if (s) return res.render('signup', { step: 2, error: null, info: null, values: { username: s.username, email: s.email } });
  res.render('signup', { step: 1, error: null, info: null, values: {} });
});

// legacy POST /signup (old bookmark/form) → bounce to wizard step 1
router.post('/signup', (req, res) => res.redirect('/signup'));

// ---- step 1: username + email → send OTP ----
router.post('/signup/start', async (req, res) => {
  if (req.session.user) return res.redirect(`/user/${encodeURIComponent(req.session.user)}`);
  const b = req.body || {};
  const values = {
    name: String(b.name || '').trim().slice(0, 60),
    username: String(b.username || '').trim().toLowerCase().slice(0, 20),
    email: String(b.email || '').trim().toLowerCase().slice(0, 100),
  };
  const back = (error, code = 400) => res.status(code).render('signup', { step: 1, error, info: null, values });

  if (!otpRate(`${req.ip}|signup-start`, 6, 60 * 60 * 1000)) return back('Too many attempts from this network — try again later.', 429);
  if (!USERNAME_RE.test(values.username)) return back('Username: 3-20 chars, only a-z, 0-9, underscore.');
  if (RESERVED.has(values.username)) return back('That username is reserved — please choose another.');
  if (!EMAIL_RE.test(values.email)) return back('Valid email required — the verification OTP will be sent there.');

  if (await AdminUser.findOne({ username: values.username }).catch(() => null)) return back('That username is already taken — please choose another.', 409);
  if (await AdminUser.findOne({ email: values.email }).catch(() => null)) return back('That email is already registered — try logging in or use another email.', 409);

  // OTP storm guard — same username+email ko 45s mein sirf 1 OTP. Slow SMTP pe
  // users tap-tap-tap karte hain → 5 OTPs issue ho jate the → stale-OTP trap.
  // Per username+email (not per IP) — Render proxy req.ip rotate karta hai.
  if (!otpRate(`su|${values.username}|${values.email}`, 1, OTP_RESEND_MIN_MS)) {
    return back('An OTP was just sent for these details — wait 45s, then use the NEWEST email you received (older codes are dead).', 429);
  }

  const otp = genOtp();
  req.session.signup = {
    name: values.name, username: values.username, email: values.email,
    otpHash: await bcrypt.hash(otp, 10), // plain OTP is never stored
    otpExpiry: Date.now() + OTP_VALID_MS,
    otpAttempts: 0, verified: false, sends: 1, lastSent: Date.now(),
  };
  const sent = await sendSignupOtp(values.email, values.username, otp);
  security.logEvent(req, { reason: 'signup-otp-sent', severity: 'info', status: 200, path: '/signup/start' });
  if (!sent) return res.status(500).render('signup', { step: 2, error: 'The OTP email could not be sent — press "Resend OTP" in a moment.', info: null, values });
  return res.render('signup', { step: 2, error: null, info: `OTP sent to ${values.email} — 10 minutes valid.`, values });
});

// ---- step 2: OTP verify ----
router.post('/signup/verify', async (req, res) => {
  const s = req.session.signup;
  if (!s) return res.redirect('/signup');
  if (s.verified) return res.render('signup', { step: 3, error: null, info: null, values: s });
  const otp = String(req.body.otp || '').replace(/\D/g, '').slice(0, 6);
  const fail = (error, code = 400) => res.status(code).render('signup', { step: 2, error, info: null, values: { username: s.username, email: s.email } });

  if (Date.now() > s.otpExpiry) { req.session.signup = null; return fail('This OTP has expired — please start the signup again.'); }
  if (s.otpAttempts >= OTP_MAX_ATTEMPTS) { req.session.signup = null; security.logEvent(req, { reason: 'signup-otp-fail', severity: 'medium', status: 200, path: '/signup/verify' }); return fail('Too many wrong attempts — please start the signup again.'); }

  s.otpAttempts += 1;
  if (!(await bcrypt.compare(otp, s.otpHash))) {
    const left = OTP_MAX_ATTEMPTS - s.otpAttempts;
    if (left <= 0) { // last attempt also wrong → kill the signup state
      req.session.signup = null;
      await new Promise((r) => req.session.save(r));
      security.logEvent(req, { reason: 'signup-otp-fail', severity: 'medium', status: 200, path: '/signup/verify' });
      return fail('Too many wrong attempts — please start the signup again.');
    }
    await new Promise((r) => req.session.save(r)); // attempt count persist
    security.logEvent(req, { reason: 'signup-otp-fail', severity: 'medium', status: 200, path: '/signup/verify' });
    return fail(`Wrong OTP — ${left} attempt${left === 1 ? '' : 's'} left.`);
  }
  s.verified = true;
  await new Promise((r) => req.session.save(r));
  security.logEvent(req, { reason: 'signup-otp-verified', severity: 'info', status: 200, path: '/signup/verify' });
  return res.render('signup', { step: 3, error: null, info: 'Email verified ✓ — now set your password.', values: { username: s.username, email: s.email, name: s.name } });
});

// ---- step 2: OTP resend (rate-limited) ----
router.post('/signup/resend', async (req, res) => {
  const s = req.session.signup;
  if (!s) return res.redirect('/signup');
  if (s.verified) return res.render('signup', { step: 3, error: null, info: null, values: s });
  const values = { username: s.username, email: s.email };
  const fail = (error, code = 429) => res.status(code).render('signup', { step: 2, error, info: null, values });
  if (!otpRate(`${req.ip}|signup-resend`, 10, 60 * 60 * 1000)) return fail('Too many requests — please try again in a while.');
  if (s.sends >= OTP_MAX_SENDS) { req.session.signup = null; return fail('OTP resend limit reached — please start the signup again.'); }
  const waitLeft = OTP_RESEND_MIN_MS - (Date.now() - s.lastSent);
  if (waitLeft > 0) return fail(`Please wait ${Math.ceil(waitLeft / 1000)}s before requesting a new OTP.`);
  const otp = genOtp();
  s.otpHash = await bcrypt.hash(otp, 10);
  s.otpExpiry = Date.now() + OTP_VALID_MS;
  s.otpAttempts = 0;
  s.sends += 1;
  s.lastSent = Date.now();
  const sent = await sendSignupOtp(s.email, s.username, otp);
  if (!sent) return fail('The OTP email could not be sent — please try again in a while.', 500);
  return res.render('signup', { step: 2, error: null, info: `New OTP sent to ${s.email} — 10 minutes valid.`, values });
});

// ---- captcha image (only served to OTP-verified users) ----
router.get('/signup/captcha.svg', (req, res) => {
  const s = req.session.signup;
  if (!s || !s.verified) return res.status(404).type('text/plain').send('not found');
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // 0/o, 1/i/l confusion hataya
  const text = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  req.session.captcha = { answer: text, exp: Date.now() + 5 * 60 * 1000 };
  if (process.env.NODE_ENV !== 'production') console.log(`[DEV] captcha: ${text}`); // for automated tests (dev only)
  res.type('image/svg+xml').set('Cache-Control', 'no-store');
  res.send(captchaSvg(text));
});

// ---- step 3: password + confirm + captcha → account create ----
router.post('/signup/complete', async (req, res) => {
  const s = req.session.signup;
  if (!s || !s.verified) return res.redirect('/signup');
  const values = { username: s.username, email: s.email, name: s.name };
  const back = (error, code = 400) => res.status(code).render('signup', { step: 3, error, info: null, values });

  const pass = String(req.body.password || '');
  if (pass.length < 8 || !/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) return back('Password: minimum 8 characters with at least one letter and one number.');
  if (pass !== String(req.body.confirm || '')) return back('Passwords do not match.');

  // captcha — single-use, 5 min expiry, case-insensitive
  const cap = req.session.captcha;
  req.session.captcha = null; // single-use captcha
  const guess = String(req.body.captcha || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cap || Date.now() > cap.exp) return back('The captcha has expired — a new captcha has loaded, please type it again.', 429);
  if (guess !== cap.answer) {
    security.logEvent(req, { reason: 'signup-captcha-fail', severity: 'low', status: 200, path: '/signup/complete' });
    return back('The captcha is wrong — a new captcha has loaded, please try again.');
  }

  // max 5 signups / IP / hour (abuse shield — actual creation par)
  const now = Date.now();
  const arr = (signupRate.get(req.ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (arr.length >= 5) return back('Too many accounts created from this network — try again later.', 429);

  // race re-check — someone may have claimed it after OTP verification
  if (await AdminUser.findOne({ username: s.username }).catch(() => null)) { req.session.signup = null; return back('That username was just taken — please start the signup with a different username.', 409); }
  if (await AdminUser.findOne({ email: s.email }).catch(() => null)) { req.session.signup = null; return back('That email was just registered — please start the signup with a different email.', 409); }

  await AdminUser.create({
    username: s.username,
    passwordHash: await bcrypt.hash(pass, 12),
    role: 'user', // public signup = normal user ONLY (never admin)
    name: s.name,
    email: s.email,
    lastLoginAt: new Date(),
  });
  arr.push(now);
  signupRate.set(req.ip, arr);
  req.session.signup = null;
  security.logEvent(req, { reason: 'signup', severity: 'info', status: 302, path: '/signup/complete' });

  // auto-login — fresh session id (fixation safe)
  const uname = s.username;
  return req.session.regenerate(() => {
    req.session.user = uname;
    res.redirect(`/user/${encodeURIComponent(uname)}`);
  });
});

// legacy admin-entrance alias → normal login (no separate public 'admin page' ever exists)
router.get('/login/adminlogin', (req, res) => res.redirect('/login'));

// ---------- brute-force lock (login) ----------
// 5 failed attempts per (IP+username) → 15 min lock, and 25 fails per IP → 15 min block.
// In-memory; resets on restart. NoSQLi-safe: inputs are coerced to plain strings.
const loginAttempts = new Map();
const ipFails = new Map();
setInterval(() => { loginAttempts.clear(); ipFails.clear(); }, 60 * 60 * 1000).unref(); // hourly sweep

router.post('/login', async (req, res) => {
  const body = req.body || {}; // never throw on empty/absent body
  const username = String(body.username || '').toLowerCase().slice(0, 40);
  const password = String(body.password || '');
  if (!username || !password) {
    security.bump(req, 'loginFail', 401);
    return res.status(401).render('admin/login', { error: 'Invalid username or password' });
  }
  const key = `${req.ip}|${username}`;
  const now = Date.now();
  const rec = loginAttempts.get(key) || { fails: 0, lockUntil: 0 };
  const ipRec = ipFails.get(req.ip) || { fails: 0, lockUntil: 0 };
  if (rec.lockUntil > now || ipRec.lockUntil > now) {
    const mins = Math.ceil((Math.max(rec.lockUntil, ipRec.lockUntil) - now) / 60000);
    return res.status(429).render('admin/login', { error: `Too many failed attempts — try again in ${mins} minute(s).` });
  }
  const user = await AdminUser.findOne({ username }).catch(() => null);
  if (user && (await bcrypt.compare(password, user.passwordHash))) {
    // ---- two-tier login ----
    // Admin credentials are NEVER accepted here — they only work at the gated
    // /user/sudhanshu/admin/login page. Probing counts as a failed attempt.
    if (user.role === 'admin') {
      rec.fails++;
      if (rec.fails >= 5) { rec.lockUntil = now + 15 * 60 * 1000; rec.fails = 0; }
      loginAttempts.set(key, rec);
      security.bump(req, 'loginFail', 401); // probing admin creds at public login → counted
      await new Promise((r) => setTimeout(r, 400));
      return res.status(401).render('admin/login', { error: 'Invalid username or password' });
    }
    loginAttempts.delete(key);
    ipFails.delete(req.ip);
    AdminUser.updateOne({ username: user.username }, { lastLoginAt: new Date() }).catch(() => {});
    security.logEvent(req, { reason: 'login-success', severity: 'info', status: 302, path: '/login' });
    // normal user session — fresh session id (fixation fix), → own dashboard
    return req.session.regenerate(() => {
      req.session.user = user.username;
      res.redirect(`/user/${encodeURIComponent(user.username)}`);
    });
  }
  rec.fails++;
  if (rec.fails >= 5) {
    rec.lockUntil = now + 15 * 60 * 1000;
    rec.fails = 0;
  }
  loginAttempts.set(key, rec);
  ipRec.fails++;
  if (ipRec.fails >= 25) {
    ipRec.lockUntil = now + 15 * 60 * 1000;
    ipRec.fails = 0;
  }
  ipFails.set(req.ip, ipRec);
  security.bump(req, 'loginFail', 401); // feeds auto-block + security log
  await new Promise((r) => setTimeout(r, 400)); // slow down online brute force
  res.status(401).render('admin/login', { error: 'Invalid username or password' });
});

router.post('/logout', (req, res) => {
  const wasAdmin = !!(req.session && req.session.admin);
  const fromPanel = String(req.originalUrl || '').startsWith('/' + ADMIN_PATH);
  req.session.destroy(() => res.redirect(wasAdmin && fromPanel ? go('/login') : '/'));
});

// ---------- forgot password (email OTP) — self-service recovery ----------
const GENERIC_MSG = 'If these details match an admin account, an OTP has been sent to the email (valid for 3 minutes).';
const otpRequests = new Map(); // ip|username → [timestamps]
setInterval(() => otpRequests.clear(), 60 * 60 * 1000).unref();

function otpRate(key, max, windowMs) {
  const now = Date.now();
  const arr = (otpRequests.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  otpRequests.set(key, arr);
  return true;
}

router.get('/forgot', (req, res) => {
  res.render('admin/forgot', { step: 'request', error: null, info: null, username: '' });
});

router.post('/forgot', async (req, res) => {
  const u = String(req.body.username || '').trim().toLowerCase().slice(0, 40);
  // separate bucket from /forgot/verify — verify attempts must not eat the request budget
  if (!otpRate(`${req.ip}|forgot|${u}`, 3, 15 * 60 * 1000)) {
    return res.render('admin/forgot', { step: 'request', error: 'Too many requests — try again after 15 minutes.', info: null, username: '' });
  }
  await new Promise((r) => setTimeout(r, 300)); // slow account enumeration
  const user = await AdminUser.findOne({ username: u }).catch(() => null);
  const email = String(req.body.email || '').trim().toLowerCase();
  if (user && user.email && email === user.email) {
    const otp = String(require('crypto').randomInt(0, 1e6)).padStart(6, '0');
    user.otpHash = await bcrypt.hash(otp, 10); // plain OTP is never stored
    user.otpExpiry = new Date(Date.now() + 3 * 60 * 1000); // 3 min
    user.otpAttempts = 0;
    await user.save();
    const { text, html } = otpTemplate({
      heading: 'Password Reset',
      intro: 'use this one-time code to reset your account password:',
      otp,
      validityMins: 3,
      name: u,
    });
    const sent = await sendMail({
      to: user.email,
      subject: '🔐 Password reset code — Portfolio', // OTP never in the subject
      text,
      html,
    });
    if (!sent && process.env.NODE_ENV !== 'production') console.log(`[DEV] OTP for ${u}: ${otp}`); // SMTP not set → dev console only (never in production responses)
  }
  // always the same generic answer — nobody learns whether the account exists
  res.render('admin/forgot', { step: 'otp', error: null, info: GENERIC_MSG, username: u });
});

router.post('/forgot/verify', async (req, res) => {
  const u = String(req.body.username || '').trim().toLowerCase().slice(0, 40);
  const otp = String(req.body.otp || '').replace(/\D/g, '').slice(0, 6);
  if (!otpRate(`${req.ip}|verify|${u}`, 10, 15 * 60 * 1000)) {
    return res.render('admin/forgot', { step: 'otp', error: 'Too many attempts — try again in a few minutes.', info: null, username: u });
  }
  const user = await AdminUser.findOne({ username: u }).catch(() => null);
  const valid =
    user && user.otpHash && user.otpExpiry && user.otpExpiry > new Date() &&
    user.otpAttempts < 5 && otp.length === 6 &&
    (await bcrypt.compare(otp, user.otpHash));
  if (!valid) {
    if (user && user.otpHash) {
      user.otpAttempts += 1; // 5 wrong attempts → OTP dead
      await user.save();
    }
    security.logEvent(req, { reason: 'otp-fail', severity: 'medium', status: 200, path: '/forgot/verify' });
    return res.render('admin/forgot', { step: 'otp', error: 'OTP is wrong or expired — try again.', info: null, username: u });
  }
  // OTP correct — 5 min reset window (kept in session, never in URLs)
  req.session.resetAuth = { user: u, exp: Date.now() + 5 * 60 * 1000 };
  res.redirect('/reset');
});

router.get('/reset', (req, res) => {
  if (!req.session.resetAuth || req.session.resetAuth.exp < Date.now()) return res.redirect('/forgot');
  res.render('admin/forgot', { step: 'reset', error: null, info: null, username: req.session.resetAuth.user });
});

router.post('/reset', async (req, res) => {
  if (!req.session.resetAuth || req.session.resetAuth.exp < Date.now()) return res.redirect('/forgot');
  const u = req.session.resetAuth.user;
  const p = String(req.body.password || '');
  const strong = p.length >= 10 && /[a-zA-Z]/.test(p) && /[0-9]/.test(p);
  if (!strong) {
    return res.render('admin/forgot', { step: 'reset', error: 'Password too weak — minimum 10 characters with at least one letter and one number.', info: null, username: u });
  }
  if (p !== String(req.body.confirm || '')) {
    return res.render('admin/forgot', { step: 'reset', error: 'Passwords do not match.', info: null, username: u });
  }
  const user = await AdminUser.findOne({ username: u });
  if (!user) return res.redirect('/forgot');
  user.passwordHash = await bcrypt.hash(p, 12);
  user.otpHash = '';
  user.otpExpiry = undefined;
  user.otpAttempts = 0;
  await user.save();
  delete req.session.resetAuth;
  req.session.destroy(() => res.redirect('/login?reset=1'));
});

// everything below requires login
router.use(requireAuth);

// ---------- dashboard ----------
router.get('/', async (req, res) => {
  const range = ['7d', '30d', '1y'].includes(req.query.range) ? req.query.range : '7d';
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 365;

  const [projects, skills, unread, tools, services, testimonials, totalMsgs, totalViews, viewsToday, labs, blockedNow, threatsToday, userCount] = await Promise.all([
    Project.countDocuments(),
    Skill.countDocuments(),
    Message.countDocuments({ read: false }),
    Tool.countDocuments(),
    Service.countDocuments(),
    Testimonial.countDocuments(),
    Message.countDocuments(),
    PageView.countDocuments(),
    PageView.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
    Lab.countDocuments(),
    BlockedIp.countDocuments({ $or: [{ until: null }, { until: { $gt: new Date() } }] }),
    SecurityEvent.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }, reason: { $ne: 'visit' } }),
    AdminUser.countDocuments(),
  ]);

  // chart: daily bars for 7d/30d, monthly for 1y
  const since = new Date(Date.now() - (days - 1) * 864e5);
  since.setHours(0, 0, 0, 0);
  const fmt = range === '1y' ? '%Y-%m' : '%Y-%m-%d';
  const [raw, topPages, recent] = await Promise.all([
    PageView.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: fmt, date: '$createdAt' } }, count: { $sum: 1 } } },
    ]),
    PageView.aggregate([{ $group: { _id: '$path', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]),
    Message.find().sort({ createdAt: -1 }).limit(4),
  ]);
  const keyMap = Object.fromEntries(raw.map((d) => [d._id, d.count]));
  const chart = [];
  let rangeViews = 0;
  if (range === '1y') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toISOString().slice(0, 7);
      const count = keyMap[key] || 0;
      rangeViews += count;
      chart.push({ label: d.toLocaleDateString('en-IN', { month: 'short' }), count });
    }
  } else {
    const step = range === '30d' ? 3 : 1; // label every 3rd day for 30d (avoid crowding)
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const key = d.toISOString().slice(0, 10);
      const count = keyMap[key] || 0;
      rangeViews += count;
      const showLabel = range === '7d' || (days - 1 - i) % step === 0;
      chart.push({
        label: showLabel ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '',
        count,
      });
    }
  }
  const maxCount = Math.max(1, ...chart.map((c) => c.count));

  res.render('admin/dashboard', {
    counts: { projects, skills, unread, tools, services, testimonials, labs, blockedNow, threatsToday, userCount },
    stats: { totalMsgs, totalViews, viewsToday, rangeViews },
    chart,
    maxCount,
    topPages,
    recent,
    range,
  });
});

// ---------- user accounts manager (admin sees + changes EVERYONE) ----------
// Every user's details are managed here; admin can change username/password/details
// and create/delete accounts. Guards: self-protect.
const userPageData = async () => {
  const users = await AdminUser.find().sort({ createdAt: -1 }).lean();
  return users;
};

router.get('/users', async (req, res) => {
  res.render('admin/users', {
    users: await userPageData(),
    me: req.session.admin,
    msg: req.query.msg || '',
  });
});

const cleanProfile = (b) => ({
  name: String(b.name || '').trim().slice(0, 60),
  email: String(b.email || '').trim().toLowerCase().slice(0, 100),
  phone: String(b.phone || '').replace(/[^0-9+\-\s()]/g, '').slice(0, 20),
  bio: String(b.bio || '').trim().slice(0, 300),
});

// create a new account (user or admin — admins are created here too)
router.post('/users/create', async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim().toLowerCase().slice(0, 20);
  const pass = String(b.password || '');
  const role = b.role === 'admin' ? 'admin' : 'user';
  const fail = (m) => res.redirect(go(`/admin/users?msg=${encodeURIComponent(m)}`));
  if (!USERNAME_RE.test(username)) return fail('Invalid username (3-20 chars: a-z, 0-9, _)');
  if (RESERVED.has(username)) return fail('That username is reserved');
  if (pass.length < 8 || !/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) return fail('Password: min 8 chars with a letter + number');
  if (await AdminUser.findOne({ username }).catch(() => null)) return fail('Username already taken');
  await AdminUser.create({ username, passwordHash: await bcrypt.hash(pass, 12), role, name: String(b.name || '').trim().slice(0, 60) });
  res.redirect(go(`/admin/users?msg=${encodeURIComponent(`Account '${username}' created (${role})`)}`));
});

router.post('/users/:id/details', async (req, res) => {
  await AdminUser.findByIdAndUpdate(req.params.id, cleanProfile(req.body || {})).catch(() => {});
  res.redirect(go('/admin/users?msg=Details+updated'));
});

router.post('/users/:id/username', async (req, res) => {
  const target = await AdminUser.findById(req.params.id).catch(() => null);
  const fail = (m) => res.redirect(go(`/admin/users?msg=${encodeURIComponent(m)}`));
  if (!target) return fail('User not found');
  if (target.username === 'sudhanshu') return fail("The username 'sudhanshu' cannot be changed (the admin-gate is tied to it)");
  const nu = String((req.body || {}).username || '').trim().toLowerCase().slice(0, 20);
  if (!USERNAME_RE.test(nu)) return fail('Invalid username (3-20 chars: a-z, 0-9, _)');
  if (RESERVED.has(nu)) return fail('That username is reserved');
  if (nu !== target.username && (await AdminUser.findOne({ username: nu }).catch(() => null))) return fail('Username already taken');
  target.username = nu;
  await target.save();
  res.redirect(go(`/admin/users?msg=${encodeURIComponent('Username changed to ' + nu)}`));
});

router.post('/users/:id/password', async (req, res) => {
  const pass = String((req.body || {}).password || '');
  const fail = (m) => res.redirect(go(`/admin/users?msg=${encodeURIComponent(m)}`));
  if (pass.length < 8 || !/[a-zA-Z]/.test(pass) || !/[0-9]/.test(pass)) return fail('Password: min 8 chars with a letter + number');
  const target = await AdminUser.findById(req.params.id).catch(() => null);
  if (!target) return fail('User not found');
  target.passwordHash = await bcrypt.hash(pass, 12);
  target.otpHash = ''; // stale reset-OTP dead
  target.otpExpiry = undefined;
  target.otpAttempts = 0;
  await target.save();
  security.logEvent(req, { reason: 'admin-reset-password', severity: 'medium', status: 200, path: '/admin/users' });
  res.redirect(go(`/admin/users?msg=${encodeURIComponent('Password changed for ' + target.username)}`));
});

router.post('/users/:id/role', async (req, res) => {
  const target = await AdminUser.findById(req.params.id).catch(() => null);
  const fail = (m) => res.redirect(go(`/admin/users?msg=${encodeURIComponent(m)}`));
  if (!target) return fail('User not found');
  if (target.username === req.session.admin) return fail('You cannot change your own role');
  const role = (req.body || {}).role === 'admin' ? 'admin' : 'user';
  if (target.role === 'admin' && role === 'user') {
    const admins = await AdminUser.countDocuments({ role: 'admin' });
    if (admins <= 1) return fail('The last admin cannot be demoted');
  }
  target.role = role;
  await target.save();
  res.redirect(go(`/admin/users?msg=${encodeURIComponent(target.username + ' is now ' + role)}`));
});

router.post('/users/:id/delete', async (req, res) => {
  const target = await AdminUser.findById(req.params.id).catch(() => null);
  const fail = (m) => res.redirect(go(`/admin/users?msg=${encodeURIComponent(m)}`));
  if (!target) return fail('User not found');
  if (target.username === req.session.admin) return fail('You cannot delete your own account');
  if (target.role === 'admin') {
    const admins = await AdminUser.countDocuments({ role: 'admin' });
    if (admins <= 1) return fail('The last admin cannot be deleted');
  }
  await target.deleteOne();
  res.redirect(go(`/admin/users?msg=${encodeURIComponent('Account ' + target.username + ' deleted')}`));
});

// ---------- security & visitors (logs, blocked IPs, unblock) ----------
router.get('/security', async (req, res) => {
  const filter = {};
  if (req.query.ip && security.isIp(req.query.ip)) filter.ip = String(req.query.ip).slice(0, 45);
  if (['info', 'low', 'medium', 'high'].includes(req.query.sev)) filter.severity = req.query.sev;
  if (req.query.reason && /^[a-z-]{2,30}$/i.test(req.query.reason)) filter.reason = req.query.reason;

  const page = Math.min(100, Math.max(1, parseInt(req.query.page, 10) || 1));
  const perPage = 50;
  const midnight = new Date(new Date().setHours(0, 0, 0, 0));
  const since30 = new Date(Date.now() - 30 * 864e5);

  const [events, total, blocked, stats] = await Promise.all([
    SecurityEvent.find(filter).sort({ createdAt: -1 }).skip((page - 1) * perPage).limit(perPage).lean(),
    SecurityEvent.countDocuments(filter),
    BlockedIp.find().sort({ createdAt: -1 }).lean(),
    Promise.all([
      SecurityEvent.countDocuments({ createdAt: { $gte: midnight }, reason: { $ne: 'visit' } }),
      SecurityEvent.countDocuments({ createdAt: { $gte: since30 } }),
      SecurityEvent.countDocuments({ severity: 'high', createdAt: { $gte: since30 } }),
      BlockedIp.countDocuments({ $or: [{ until: null }, { until: { $gt: new Date() } }] }),
    ]),
  ]);
  // active vs expired split for the UI
  const now = new Date();
  const blockedActive = blocked.filter((b) => !b.until || b.until > now);
  const blockedExpired = blocked.filter((b) => b.until && b.until <= now);

  res.render('admin/security', {
    events, total, page, perPage,
    filter: { ip: req.query.ip || '', sev: req.query.sev || '', reason: req.query.reason || '' },
    stats: { todayThreats: stats[0], total30d: stats[1], high30d: stats[2], activeBlocks: stats[3] },
    blockedActive, blockedExpired,
    uptime: require('../services/uptime').status(),
  });
});

router.post('/security/block', async (req, res) => {
  const ip = String(req.body.ip || '').trim().slice(0, 45);
  const hours = parseInt(req.body.hours, 10);
  const reason = String(req.body.reason || '').trim().slice(0, 200) || 'Manually blocked by admin';
  if (!security.isIp(ip) || security.isPrivateIp(ip)) return res.redirect(go('/admin/security?err=badip'));
  const ms = Number.isFinite(hours) && hours > 0 ? hours * 3600 * 1000 : 0; // 0/blank = permanent
  await security.blockIp(ip, reason, ms, false);
  security.logEvent(req, { reason: 'manual-block', severity: 'medium', status: 200, path: '/security' });
  res.redirect(go('/admin/security?blocked=1'));
});

router.post('/security/unblock', async (req, res) => {
  const ip = String(req.body.ip || '').trim().slice(0, 45);
  if (security.isIp(ip)) await security.unblockIp(ip);
  res.redirect(go('/admin/security?unblocked=1'));
});

router.post('/security/clear', async (req, res) => {
  await SecurityEvent.deleteMany({});
  res.redirect(go('/admin/security?cleared=1'));
});

// ---------- settings ----------
router.get('/settings', (req, res) => res.render('admin/settings'));

router.post('/settings', upload.single('photo'), async (req, res) => {
  const s = await SiteSetting.get();
  // per-field length caps (match the schema limits)
  const caps = { siteName: 100, heroTitle: 150, heroSubtitle: 300, aboutText: 5000, email: 100, phone: 20, location: 120, githubUsername: 60, thmUsername: 60 };
  Object.entries(caps).forEach(([f, n]) => {
    if (req.body[f] !== undefined) s[f] = String(req.body[f]).slice(0, n);
  });
  // social URLs stored http(s)-only (javascript:/data: XSS blocked at write time)
  ['github', 'linkedin', 'twitter', 'instagram'].forEach((f) => {
    if (req.body[f] !== undefined) s[f] = safeUrl(req.body[f]);
  });
  if (req.body.whatsapp !== undefined) s.whatsapp = String(req.body.whatsapp).replace(/\D/g, '').slice(0, 15);
  if (req.body.telegram !== undefined) s.telegram = String(req.body.telegram).replace(/[^\w.@-]/g, '').slice(0, 60);
  if (req.file) s.profilePhoto = toDataUrl(req.file);

  // custom social links (label + url pairs) — works with both key styles
  const labels = [].concat(req.body['custom_label'] || req.body['custom_label[]'] || []);
  const urls = [].concat(req.body['custom_url'] || req.body['custom_url[]'] || []);
  s.customLinks = labels
    .map((label, i) => ({ label: String(label || '').trim().slice(0, 40), url: safeUrl(urls[i]) }))
    .filter((l) => l.label && l.url);

  await s.save();
  res.redirect(go('/admin/settings?saved=1'));
});

// ---------- resume / CV upload ----------
router.post('/resume', resumeUpload.single('resume'), async (req, res) => {
  if (!req.file) return res.redirect(go('/admin/settings?resume_error=1'));
  const s = await SiteSetting.get();
  s.resumeFile = `data:application/pdf;base64,${req.file.buffer.toString('base64')}`;
  const rawName = req.file.originalname.endsWith('.pdf') ? req.file.originalname : req.file.originalname + '.pdf';
  s.resumeName = String(rawName).slice(0, 200);
  await s.save();
  res.redirect(go('/admin/settings?resume=1'));
});

router.post('/resume/delete', async (req, res) => {
  const s = await SiteSetting.get();
  s.resumeFile = '';
  s.resumeName = 'resume.pdf';
  await s.save();
  res.redirect(go('/admin/settings?resume_deleted=1'));
});

// ---------- services (hire me) ----------
router.get('/services', async (req, res) => {
  const editService = req.query.edit && isId(req.query.edit) ? await Service.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/services', { services: await Service.find().sort({ createdAt: 1 }), editService });
});

router.post('/services', async (req, res) => {
  const { title, description, price } = req.body;
  if (title && String(title).trim()) {
    await Service.create({
      title: String(title).trim().slice(0, 100),
      description: String(description || '').slice(0, 1000),
      price: String(price || '').slice(0, 40),
    });
  }
  res.redirect(go('/admin/services'));
});

router.post('/services/:id/update', async (req, res) => {
  const { title, description, price } = req.body;
  if (title && String(title).trim()) {
    await Service.findByIdAndUpdate(req.params.id, {
      title: String(title).trim().slice(0, 100),
      description: String(description || '').slice(0, 1000),
      price: String(price || '').slice(0, 40),
    }).catch(() => {});
  }
  res.redirect(go('/admin/services'));
});

router.post('/services/:id/delete', async (req, res) => {
  await Service.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/services'));
});

// ---------- testimonials ----------
router.get('/testimonials', async (req, res) => {
  const editTestimonial = req.query.edit && isId(req.query.edit) ? await Testimonial.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/testimonials', { testimonials: await Testimonial.find().sort({ createdAt: -1 }), editTestimonial });
});

router.post('/testimonials', async (req, res) => {
  const { name, company, text, rating } = req.body;
  if (name && name.trim() && text && text.trim()) {
    await Testimonial.create({
      name: String(name).trim().slice(0, 60),
      company: String(company || '').trim().slice(0, 80),
      text: String(text).trim().slice(0, 500),
      rating: Math.min(5, Math.max(1, parseInt(rating, 10) || 5)),
    });
  }
  res.redirect(go('/admin/testimonials'));
});

router.post('/testimonials/:id/update', async (req, res) => {
  const { name, company, text, rating } = req.body;
  if (name && name.trim() && text && text.trim()) {
    await Testimonial.findByIdAndUpdate(req.params.id, {
      name: String(name).trim().slice(0, 60),
      company: String(company || '').trim().slice(0, 80),
      text: String(text).trim().slice(0, 500),
      rating: Math.min(5, Math.max(1, parseInt(rating, 10) || 5)),
    }).catch(() => {});
  }
  res.redirect(go('/admin/testimonials'));
});

router.post('/testimonials/:id/delete', async (req, res) => {
  await Testimonial.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/testimonials'));
});

// ---------- experience (work history) ----------
router.get('/experience', async (req, res) => {
  const editExp = req.query.edit && isId(req.query.edit) ? await Experience.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/experience', { experience: await Experience.find().sort({ current: -1, order: 1, createdAt: -1 }), editExp });
});

router.post('/experience', async (req, res) => {
  const { company, role, duration, description, order } = req.body;
  if (company && company.trim() && role && role.trim()) {
    await Experience.create({
      company: String(company).trim().slice(0, 80),
      role: String(role).trim().slice(0, 80),
      duration: String(duration || '').slice(0, 60),
      description: String(description || '').slice(0, 1000),
      current: req.body.current === 'on',
      order: parseInt(order, 10) || 0,
    });
  }
  res.redirect(go('/admin/experience'));
});

router.post('/experience/:id/update', async (req, res) => {
  const { company, role, duration, description, order } = req.body;
  if (company && company.trim() && role && role.trim()) {
    await Experience.findByIdAndUpdate(req.params.id, {
      company: String(company).trim().slice(0, 80),
      role: String(role).trim().slice(0, 80),
      duration: String(duration || '').slice(0, 60),
      description: String(description || '').slice(0, 1000),
      current: req.body.current === 'on',
      order: parseInt(order, 10) || 0,
    }).catch(() => {});
  }
  res.redirect(go('/admin/experience'));
});

router.post('/experience/:id/delete', async (req, res) => {
  await Experience.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/experience'));
});

// ---------- labs (TryHackMe / PortSwigger) ----------
router.get('/labs', async (req, res) => {
  const editLab = req.query.edit && isId(req.query.edit) ? await Lab.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/labs', { labs: await Lab.find().sort({ createdAt: -1 }), editLab });
});

router.post('/labs', async (req, res) => {
  const { platform, title, category, difficulty, url, solvedAt } = req.body;
  if (title && title.trim()) {
    await Lab.create({
      platform: platform || 'TryHackMe',
      title: String(title).trim().slice(0, 120),
      category: String(category || 'General').trim().slice(0, 40),
      difficulty: String(difficulty || 'Easy').slice(0, 20),
      url: safeUrl(url),
      solvedAt: solvedAt ? new Date(solvedAt) : undefined,
    });
  }
  res.redirect(go('/admin/labs'));
});

router.post('/labs/:id/update', async (req, res) => {
  const { platform, title, category, difficulty, url, solvedAt } = req.body;
  if (title && title.trim()) {
    await Lab.findByIdAndUpdate(req.params.id, {
      platform: platform || 'TryHackMe',
      title: String(title).trim().slice(0, 120),
      category: String(category || 'General').trim().slice(0, 40),
      difficulty: String(difficulty || 'Easy').slice(0, 20),
      url: safeUrl(url),
      solvedAt: solvedAt ? new Date(solvedAt) : undefined,
    }).catch(() => {});
  }
  res.redirect(go('/admin/labs'));
});

router.post('/labs/:id/delete', async (req, res) => {
  await Lab.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/labs'));
});

// ---------- feedback (public submissions → moderate → live) ----------
router.get('/feedback', async (req, res) => {
  const show = ['pending', 'approved', 'hidden', 'all'].includes(req.query.show) ? req.query.show : 'pending';
  const filter = show === 'all' ? {} : { status: show };
  // pending first, then approved, then hidden (newest first inside each group)
  const list = await Feedback.find(filter).sort({ createdAt: -1 }).lean();
  const order = { pending: 0, approved: 1, hidden: 2 };
  list.sort((a, b) => order[a.status] - order[b.status] || new Date(b.createdAt) - new Date(a.createdAt));
  res.render('admin/feedback', {
    feedbacks: list,
    counts: {
      pending: await Feedback.countDocuments({ status: 'pending' }),
      approved: await Feedback.countDocuments({ status: 'approved' }),
      hidden: await Feedback.countDocuments({ status: 'hidden' }),
    },
    show: req.query.show || 'inbox',
  });
});

router.post('/feedback/:id/approve', async (req, res) => {
  await Feedback.findByIdAndUpdate(req.params.id, { status: 'approved' }).catch(() => {});
  res.redirect(go('/admin/feedback'));
});

router.post('/feedback/:id/hide', async (req, res) => {
  await Feedback.findByIdAndUpdate(req.params.id, { status: 'hidden' }).catch(() => {});
  res.redirect(go('/admin/feedback'));
});

router.post('/feedback/:id/reply', async (req, res) => {
  const text = String(req.body.reply || '').trim().slice(0, 1000);
  // set reply; empty submit clears the reply (so a reply can be removed by submitting empty)
  const update = text ? { reply: { text, at: new Date() } } : { $unset: { reply: '' } };
  await Feedback.findByIdAndUpdate(req.params.id, update).catch(() => {});
  res.redirect(go('/admin/feedback'));
});

router.post('/feedback/:id/delete', async (req, res) => {
  await Feedback.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/feedback'));
});

// ---------- skills ----------
router.get('/skills', async (req, res) => {
  const editSkill = req.query.edit && isId(req.query.edit) ? await Skill.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/skills', { skills: await Skill.find().sort({ category: 1, level: -1 }), editSkill });
});

router.post('/skills', async (req, res) => {
  const { name, level, category } = req.body;
  if (name && name.trim()) {
    await Skill.create({
      name: String(name).trim().slice(0, 60),
      level: Math.min(100, Math.max(0, parseInt(level, 10) || 80)),
      category: String(category || 'General').trim().slice(0, 40),
    });
  }
  res.redirect(go('/admin/skills'));
});

router.post('/skills/:id/update', async (req, res) => {
  const { name, level, category } = req.body;
  if (name && name.trim()) {
    await Skill.findByIdAndUpdate(req.params.id, {
      name: String(name).trim().slice(0, 60),
      level: Math.min(100, Math.max(0, parseInt(level, 10) || 80)),
      category: String(category || 'General').trim().slice(0, 40),
    }).catch(() => {});
  }
  res.redirect(go('/admin/skills'));
});

router.post('/skills/:id/delete', async (req, res) => {
  await Skill.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/skills'));
});

// ---------- projects ----------
router.get('/projects', async (req, res) => {
  res.render('admin/projects', { projects: await Project.find().sort({ createdAt: -1 }) });
});

router.get('/projects/new', (req, res) => res.render('admin/project_form', { project: null }));

router.post('/projects', upload.single('image'), async (req, res) => {
  const { title, description, techStack, liveUrl, githubUrl } = req.body;
  if (title && String(title).trim()) {
    await Project.create({
      title: String(title).trim().slice(0, 120),
      description: String(description || '').slice(0, 5000),
      techStack: String(techStack || '').slice(0, 300),
      liveUrl: safeUrl(liveUrl),
      githubUrl: safeUrl(githubUrl),
      featured: req.body.featured === 'on',
      image: toDataUrl(req.file),
    });
  }
  res.redirect(go('/admin/projects'));
});

router.get('/projects/:id/edit', async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.redirect(go('/admin/projects'));
  res.render('admin/project_form', { project });
});

router.post('/projects/:id', upload.single('image'), async (req, res) => {
  const p = await Project.findById(req.params.id).catch(() => null);
  if (!p) return res.redirect(go('/admin/projects'));
  Object.assign(p, {
    title: String(req.body.title || p.title).trim().slice(0, 120),
    description: String(req.body.description || '').slice(0, 5000),
    techStack: String(req.body.techStack || '').slice(0, 300),
    liveUrl: safeUrl(req.body.liveUrl),
    githubUrl: safeUrl(req.body.githubUrl),
    featured: req.body.featured === 'on',
  });
  if (req.file) p.image = toDataUrl(req.file);
  await p.save();
  res.redirect(go('/admin/projects'));
});

router.post('/projects/:id/delete', async (req, res) => {
  await Project.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/projects'));
});

// ---------- tools (for sale) ----------
router.get('/tools', async (req, res) => {
  res.render('admin/tools', { tools: await Tool.find().sort({ createdAt: -1 }) });
});

router.get('/tools/new', (req, res) => res.render('admin/tool_form', { tool: null }));

router.post('/tools', upload.single('image'), async (req, res) => {
  const { name, description, category, price, demoUrl, buyUrl } = req.body;
  if (name && String(name).trim()) {
    await Tool.create({
      name: String(name).trim().slice(0, 120),
      description: String(description || '').slice(0, 5000),
      category: String(category || 'Other').slice(0, 40),
      price: String(price || '').slice(0, 40),
      demoUrl: safeUrl(demoUrl),
      buyUrl: safeUrl(buyUrl),
      featured: req.body.featured === 'on',
      image: toDataUrl(req.file),
    });
  }
  res.redirect(go('/admin/tools'));
});

router.get('/tools/:id/edit', async (req, res) => {
  const tool = await Tool.findById(req.params.id);
  if (!tool) return res.redirect(go('/admin/tools'));
  res.render('admin/tool_form', { tool });
});

router.post('/tools/:id', upload.single('image'), async (req, res) => {
  const t = await Tool.findById(req.params.id).catch(() => null);
  if (!t) return res.redirect(go('/admin/tools'));
  Object.assign(t, {
    name: String(req.body.name || t.name).trim().slice(0, 120),
    description: String(req.body.description || '').slice(0, 5000),
    category: String(req.body.category || 'Other').slice(0, 40),
    price: String(req.body.price || '').slice(0, 40),
    demoUrl: safeUrl(req.body.demoUrl),
    buyUrl: safeUrl(req.body.buyUrl),
    featured: req.body.featured === 'on',
  });
  if (req.file) t.image = toDataUrl(req.file);
  await t.save();
  res.redirect(go('/admin/tools'));
});

router.post('/tools/:id/delete', async (req, res) => {
  await Tool.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/tools'));
});

// ---------- messages ----------
router.get('/messages', async (req, res) => {
  res.render('admin/messages', { messages: await Message.find().sort({ createdAt: -1 }) });
});

router.post('/messages/:id/read', async (req, res) => {
  await Message.findByIdAndUpdate(req.params.id, { read: true }).catch(() => {});
  res.redirect(go('/admin/messages'));
});

router.post('/messages/:id/delete', async (req, res) => {
  await Message.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/messages'));
});

// ---------- change password ----------
router.get('/password', (req, res) => res.render('admin/password', { error: null, success: false }));

router.post('/password', async (req, res) => {
  const { current_pass, new_pass, confirm_pass } = req.body;
  const user = await AdminUser.findOne({ username: req.session.admin });
  if (!user || !(await bcrypt.compare(current_pass || '', user.passwordHash))) {
    return res.render('admin/password', { error: 'Current password is wrong', success: false });
  }
  if (!new_pass || new_pass.length < 6) {
    return res.render('admin/password', { error: 'New password must be at least 6 characters', success: false });
  }
  if (new_pass !== confirm_pass) {
    return res.render('admin/password', { error: 'New passwords do not match', success: false });
  }
  user.passwordHash = await bcrypt.hash(new_pass, 10);
  await user.save();
  res.render('admin/password', { error: null, success: true });
});

module.exports = router;
