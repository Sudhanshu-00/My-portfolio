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
const { AdminUser, Project } = require('../models');
const ADMIN_PATH = require('../adminPath');

// timing-safe compare (same pattern as admin routes)
const safeEqual = (a, b) => {
  const A = Buffer.from(String(a || ''));
  const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

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

// ---------- USER DASHBOARD (read-only) ----------
router.get('/:username', requireSelf, async (req, res) => {
  const username = req.params.username;
  const csrf = issueCsrf(req);
  // admin option ONLY for the user named 'sudhanshu'
  const adminGate = username === 'sudhanshu';
  let projects = [];
  try {
    projects = await Project.find({}, 'title description techStack liveUrl githubUrl featured')
      .sort({ createdAt: -1 })
      .lean();
  } catch {
    projects = [];
  }
  res.render('user/dashboard', {
    username,
    csrf,
    adminGate,
    projects,
    saved: req.query.saved === '1',
    pwError: req.query.pwerr || null,
  });
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
    return res.redirect(`${back}?pwerr=New+passwords+do+not+match`);
  }
  if (next.length < 8) {
    return res.redirect(`${back}?pwerr=Password+must+be+at+least+8+characters`);
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
  const key = `${req.ip}|gate|${username}`;
  const now = Date.now();
  const rec = gateAttempts.get(key) || { fails: 0, lockUntil: 0 };
  if (rec.lockUntil > now) {
    const mins = Math.ceil((rec.lockUntil - now) / 60000);
    return res.status(429).render('user/admin_login', { username: req.params.username, csrf: issueCsrf(req), error: `Too many attempts — try again in ${mins} minute(s).` });
  }
  // ONLY role='admin' accounts authenticate here — normal users always bounce
  const admin = await AdminUser.findOne({ username, role: 'admin' }).catch(() => null);
  if (admin && (await bcrypt.compare(password, admin.passwordHash))) {
    gateAttempts.delete(key);
    return req.session.regenerate(() => {
      req.session.admin = admin.username; // panel session (fresh session id)
      res.redirect('/' + ADMIN_PATH + '/');
    });
  }
  rec.fails += 1;
  if (rec.fails >= 5) {
    rec.lockUntil = now + 15 * 60 * 1000;
    rec.fails = 0;
  }
  gateAttempts.set(key, rec);
  await new Promise((r) => setTimeout(r, 400)); // slow online brute force
  res.status(401).render('user/admin_login', { username: req.params.username, csrf: issueCsrf(req), error: 'Invalid admin credentials' });
});

module.exports = router;
