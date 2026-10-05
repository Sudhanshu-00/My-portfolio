/**
 * User-tier routes — normal (non-admin) dashboard:
 *   GET  /user/:username               → own dashboard (projects read-only + password change)
 *   POST /user/:username/password      → change own password (current password required)
 *   GET  /user/:username/admin/login   → gated admin login (ONLY when user 'sudhanshu' is logged in)
 *   POST /user/:username/admin/login   → admin credentials here → secret panel
 */
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { AdminUser, Project, Tool, Lab, Experience, Testimonial, Service } = require('../models');
const ADMIN_PATH = require('../adminPath');
const security = require('../services/security');
const captchaSvg = require('../services/captcha');

// password policy — same as admin routes (capital + small + number + symbol, min 8)
const PASSWORD_MSG = 'Password: minimum 8 characters with at least one UPPERCASE letter, one lowercase letter, one number and one symbol (e.g. Aa1!xyz9).';
const strongPass = (p) => typeof p === 'string' && p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

// timing-safe compare (same pattern as admin routes)
const safeEqual = (a, b) => {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
// dummy bcrypt hash — unknown username par bhi same compare-cost (timing-equalizer,
// response-time delta se admin-username enumeration block)
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer::' + crypto.randomBytes(16).toString('hex'), 12);

// issue CSRF token for user-tier forms
const issueCsrf = (req) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  return req.session.csrf;
};

// gate: must be logged in as exactly this user
const requireSelf = (req, res, next) => {
  const me = req.session && req.session.user;
  if (!me) return res.redirect('/login');
  if (me !== req.params.username) {
    return res.redirect(me ? `/user/${encodeURIComponent(me)}` : '/login');
  }
  next();
};

// ---------- USER DASHBOARD (read-only site data + own profile) ----------
router.get('/:username', requireSelf, async (req, res) => {
  const username = req.params.username;
  const csrf = issueCsrf(req);
  // admin option ONLY for the user named 'sudhanshu'
  const adminGate = username === 'sudhanshu';
  let projects = [];
  let tools = [];
  let profile = {};
  let stats = { projects: 0, tools: 0, labs: 0, experience: 0, testimonials: 0, services: 0 };
  try {
    [projects, tools, profile] = await Promise.all([
      Project.find({}, 'title description techStack liveUrl githubUrl featured')
        .sort({ createdAt: -1 })
        .lean(),
      Tool.find({}, 'name').sort({ name: 1 }).lean(),
      AdminUser.findOne({ username }, 'name email phone bio role createdAt lastLoginAt').lean(),
    ]);
    stats = {
      projects: await Project.countDocuments(),
      tools: await Tool.countDocuments(),
      labs: await Lab.countDocuments(),
      experience: await Experience.countDocuments(),
      testimonials: await Testimonial.countDocuments(),
      services: await Service.countDocuments(),
    };
  } catch {
    projects = [];
    tools = [];
  }
  res.render('user/dashboard', {
    username,
    csrf,
    adminGate,
    profile: profile || {},
    projects,
    tools,
    stats,
    saved: req.query.saved === '1',
    pwError: req.query.pwerr || null,
  });
});

// ---------- EDIT OWN PROFILE (own details only — requireSelf guard) ----------
router.post('/:username/profile', requireSelf, async (req, res) => {
  const back = `/user/${encodeURIComponent(req.params.username)}`;
  const body = req.body || {};
  const csrf = String(body._csrf || '');
  if (!req.session.csrf || !csrf || !safeEqual(req.session.csrf, csrf)) {
    return res.redirect(`${back}?pwerr=Security+check+failed+—+reload+the+page`);
  }
  const email = String(body.email || '').trim().toLowerCase().slice(0, 100);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.redirect(`${back}?pwerr=${encodeURIComponent('That email address does not look valid.')}`);
  }
  // email unique — doosre account ka email claim nahi kar sakte (/forgot isi par depend karta hai)
  if (email) {
    const dup = await AdminUser.findOne({ email, username: { $ne: req.params.username } }).catch(() => null);
    if (dup) return res.redirect(`${back}?pwerr=${encodeURIComponent('That email is already used by another account.')}`);
  }
  await AdminUser.updateOne(
    { username: req.params.username },
    {
      name: String(body.name || '').trim().slice(0, 60),
      email,
      phone: String(body.phone || '').replace(/[^0-9+\-\s()]/g, '').slice(0, 20),
      bio: String(body.bio || '').trim().slice(0, 300),
    }
  );
  res.redirect(`${back}?saved=1`);
});

// ---------- CHANGE OWN PASSWORD ----------
router.post('/:username/password', requireSelf, async (req, res) => {
  const back = `/user/${encodeURIComponent(req.params.username)}`;
  const body = req.body || {};
  const current = String(body.current || '');
  const next = String(body.next || '');
  const confirm = String(body.confirm || '');
  const csrf = String(body._csrf || '');
  if (!req.session.csrf || !csrf || !safeEqual(req.session.csrf, csrf)) {
    return res.redirect(`${back}?pwerr=Security+check+failed+—+reload+the+page`);
  }
  if (!current || !next || next !== confirm) {
    return res.redirect(`${back}?pwerr=${encodeURIComponent(next !== confirm && current ? 'Password+not+match+—+new+passwords+do+not+match' : 'All+password+fields+are+required')}`);
  }
  if (!strongPass(next)) {
    return res.redirect(`${back}?pwerr=${encodeURIComponent(PASSWORD_MSG)}`);
  }
  const me = await AdminUser.findOne({ username: req.params.username }).catch(() => null);
  if (!me || !(await bcrypt.compare(current, me.passwordHash))) {
    return res.redirect(`${back}?pwerr=Current+password+is+wrong`);
  }
  me.passwordHash = await bcrypt.hash(next, 12);
  await me.save();
  res.redirect(`${back}?saved=1`);
});

// ---------- GATED ADMIN LOGIN ----------
// reachable ONLY while the normal user 'sudhanshu' is logged in
const adminGate = (req, res, next) => {
  const me = req.session && req.session.user;
  if (!me || me !== 'sudhanshu' || me !== req.params.username) {
    return res.redirect('/login'); // nobody even learns this page exists
  }
  next();
};

router.get('/:username/admin/login', adminGate, (req, res) => {
  const csrf = issueCsrf(req);
  res.render('user/admin_login', { username: req.params.username, csrf, error: null });
});

// captcha image for the gated admin login (session-stored, single-use)
router.get('/:username/admin/captcha.svg', adminGate, (req, res) => {
  const text = captchaSvg.newText();
  req.session.captcha = { answer: text, exp: Date.now() + 5 * 60 * 1000 };
  if (process.env.NODE_ENV !== 'production') console.log(`[DEV] gate captcha: ${text}`);
  res.type('image/svg+xml').set('Cache-Control', 'no-store');
  res.send(captchaSvg(text));
});

// simple per-(ip|username) throttle for admin-gate login
const gateAttempts = new Map();
setInterval(() => gateAttempts.clear(), 60 * 60 * 1000).unref();

router.post('/:username/admin/login', adminGate, async (req, res) => {
  const back = `/user/${encodeURIComponent(req.params.username)}/admin/login`;
  const body = req.body || {};
  const username = String(body.username || '').toLowerCase().slice(0, 40);
  const password = String(body.password || '');
  const csrf = String(body._csrf || '');
  if (!req.session.csrf || !csrf || !safeEqual(req.session.csrf, csrf)) {
    return res.status(403).render('user/admin_login', { username: req.params.username, csrf: issueCsrf(req), error: 'Security check failed — reload and try again.' });
  }
  // ---- captcha check — single-use (blocks automated credential stuffing) ----
  const cap = req.session.captcha;
  req.session.captcha = null;
  const guess = String(body.captcha || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cap || Date.now() > cap.exp || !guess || guess !== cap.answer) {
    security.bump(req, 'loginFail', 401);
    return res.status(401).render('user/admin_login', { username: req.params.username, csrf: issueCsrf(req), error: 'Wrong or expired captcha — a new captcha has loaded, please try again.' });
  }
  const key = `${req.ip}|gate|${username}`;
  const now = Date.now();
  const rec = gateAttempts.get(key) || { fails: 0, lockUntil: 0 };
  if (rec.lockUntil > now) {
    const mins = Math.ceil((rec.lockUntil - now) / 60000);
    return res.status(429).render('user/admin_login', { username: req.params.username, csrf: issueCsrf(req), error: `Too many attempts — try again in ${mins} minute(s).` });
  }
  // ONLY role='admin' accounts authenticate here — normal users always bounce
  const admin = await AdminUser.findOne({ username, role: 'admin' }).catch(() => null);
  // timing-equalizer — unknown username par bhi bcrypt cost same rakho
  const passOk = await bcrypt.compare(password, admin ? admin.passwordHash : DUMMY_HASH);
  if (admin && passOk) {
    gateAttempts.delete(key);
    AdminUser.updateOne({ username: admin.username }, { lastLoginAt: new Date() }).catch(() => {});
    security.logEvent(req, { reason: 'admin-login', severity: 'info', status: 302, path: '/user/[user]/admin/login' });
    const me = req.session.user; // keep the normal-user login alive across the panel login
    return req.session.regenerate(() => {
      req.session.admin = admin.username; // panel session (fresh session id — fixation safe)
      if (me) req.session.user = me; // dashboard tab keeps working; logging out still ends BOTH
      res.redirect('/' + ADMIN_PATH + '/');
    });
  }
  rec.fails += 1;
  if (rec.fails >= 5) {
    rec.lockUntil = now + 15 * 60 * 1000;
    rec.fails = 0;
  }
  gateAttempts.set(key, rec);
  security.bump(req, 'loginFail', 401); // failed admin-gate attempt → auto-block counter
  await new Promise((r) => setTimeout(r, 400)); // slow online brute force
  res.status(401).render('user/admin_login', { username: req.params.username, csrf: issueCsrf(req), error: 'Invalid admin credentials' });
});

module.exports = router;
