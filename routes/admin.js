const router = require('express').Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { AdminUser, Project, Skill, Message, SiteSetting, Tool, PageView, Service, Testimonial, Experience, Lab, Feedback } = require('../models');
const { sendMail } = require('../services/mailer');

// Secret admin path (server.js ke secret-mount se match hona chahiye)
const ADMIN_PATH = process.env.ADMIN_PATH || 'admin';
const go = (p) => '/' + ADMIN_PATH + p; // redirects secret-path aware

// ---------- photo upload helper ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
const toDataUrl = (f) => (f ? `data:${f.mimetype};base64,${f.buffer.toString('base64')}` : '');

// ---------- resume (PDF) upload helper ----------
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});

// ---------- auth ----------
const requireAuth = async (req, res, next) => {
  if (req.session.admin) {
    res.locals.admin = req.session.admin; // username for views
    res.locals.path = '/admin' + req.path; // sidebar active-state (router prefix-stripped path deta hai)
    res.locals.unread = await Message.countDocuments({ read: false });
    res.locals.pendingFeedback = await Feedback.countDocuments({ status: 'pending' });
    return next();
  }
  res.redirect(go('/login'));
};

router.get('/login', (req, res) => (req.session.admin ? res.redirect(go('/admin')) : res.render('admin/login', { error: null })));

// ---------- brute-force lock (login) ----------
// 5 failed attempts (IP+username) → 15 min lock. In-memory, restart pe reset.
const loginAttempts = new Map();
setInterval(() => loginAttempts.clear(), 60 * 60 * 1000).unref(); // ghante me ek sweep

router.post('/login', async (req, res) => {
  const key = `${req.ip}|${String(req.body.username || '').toLowerCase().slice(0, 40)}`;
  const rec = loginAttempts.get(key) || { fails: 0, lockUntil: 0 };
  if (rec.lockUntil > Date.now()) {
    const mins = Math.ceil((rec.lockUntil - Date.now()) / 60000);
    return res.status(429).render('admin/login', { error: `Too many failed attempts — ${mins} min baad try karo.` });
  }
  const { username, password } = req.body;
  const user = await AdminUser.findOne({ username });
  if (user && (await bcrypt.compare(password || '', user.passwordHash))) {
    loginAttempts.delete(key);
    // session fixation fix — login pe fresh session id
    return req.session.regenerate(() => {
      req.session.admin = user.username;
      res.redirect(go('/'));
    });
  }
  rec.fails++;
  if (rec.fails >= 5) {
    rec.lockUntil = Date.now() + 15 * 60 * 1000;
    rec.fails = 0;
  }
  loginAttempts.set(key, rec);
  await new Promise((r) => setTimeout(r, 400)); // online brute-force slow
  res.status(401).render('admin/login', { error: 'Invalid username or password' });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect(go('/login'))));

// ---------- forgot password (email OTP) — self-service recovery ----------
const GENERIC_MSG = 'Agar ye details admin account se match hui, OTP email pe chala gaya hai (10 min valid).';
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
  if (!otpRate(`${req.ip}|${u}`, 3, 15 * 60 * 1000)) {
    return res.render('admin/forgot', { step: 'request', error: 'Bahut zyada requests — 15 min baad try karo.', info: null, username: '' });
  }
  await new Promise((r) => setTimeout(r, 300)); // enumeration slow
  const user = await AdminUser.findOne({ username: u }).catch(() => null);
  const email = String(req.body.email || '').trim().toLowerCase();
  if (user && user.email && email === user.email) {
    const otp = String(require('crypto').randomInt(0, 1e6)).padStart(6, '0');
    user.otpHash = await bcrypt.hash(otp, 10); // plain OTP kabhi store nahi
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    user.otpAttempts = 0;
    await user.save();
    const sent = await sendMail({
      to: user.email,
      subject: 'Password Reset OTP — Portfolio Admin',
      text: `Reset OTP: ${otp}\n10 minute me expire. Agar tumne request nahi ki, ignore karo.`,
      html: `<p>Reset OTP: <b style="font-size:24px;letter-spacing:4px">${otp}</b></p><p>10 minute me expire. Agar tumne ye request nahi ki, email ignore karo.</p>`,
    });
    if (!sent) console.log(`[DEV] OTP for ${u}: ${otp}`); // SMTP set nahi → sirf server console
  }
  // hamesha same generic jawab — kisi ko pata na chale account hai ya nahi
  res.render('admin/forgot', { step: 'otp', error: null, info: GENERIC_MSG, username: u });
});

router.post('/forgot/verify', async (req, res) => {
  const u = String(req.body.username || '').trim().toLowerCase().slice(0, 40);
  const otp = String(req.body.otp || '').replace(/\D/g, '').slice(0, 6);
  if (!otpRate(`${req.ip}|${u}`, 10, 15 * 60 * 1000)) {
    return res.render('admin/forgot', { step: 'otp', error: 'Too many attempts — thodi der baad try karo.', info: null, username: u });
  }
  const user = await AdminUser.findOne({ username: u }).catch(() => null);
  const valid =
    user && user.otpHash && user.otpExpiry && user.otpExpiry > new Date() &&
    user.otpAttempts < 5 && otp.length === 6 &&
    (await bcrypt.compare(otp, user.otpHash));
  if (!valid) {
    if (user && user.otpHash) {
      user.otpAttempts += 1; // 5 galat → OTP dead
      await user.save();
    }
    return res.render('admin/forgot', { step: 'otp', error: 'OTP galat ya expire — dobara try karo.', info: null, username: u });
  }
  // OTP sahi — 10 min ka reset window (session me, URL me token nahi)
  req.session.resetAuth = { user: u, exp: Date.now() + 10 * 60 * 1000 };
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
    return res.render('admin/forgot', { step: 'reset', error: 'Password weak — min 10 characters, letter + number dono ho.', info: null, username: u });
  }
  if (p !== String(req.body.confirm || '')) {
    return res.render('admin/forgot', { step: 'reset', error: 'Dono passwords same nahi hain.', info: null, username: u });
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

  const [projects, skills, unread, tools, services, testimonials, totalMsgs, totalViews, viewsToday, labs] = await Promise.all([
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
    const step = range === '30d' ? 3 : 1; // 30d me har 3rd day ka label (crowding avoid)
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
    counts: { projects, skills, unread, tools, services, testimonials, labs },
    stats: { totalMsgs, totalViews, viewsToday, rangeViews },
    chart,
    maxCount,
    topPages,
    recent,
    range,
  });
});

// ---------- settings ----------
router.get('/settings', (req, res) => res.render('admin/settings'));

router.post('/settings', upload.single('photo'), async (req, res) => {
  const s = await SiteSetting.get();
  ['siteName', 'heroTitle', 'heroSubtitle', 'aboutText', 'email', 'phone', 'location', 'github', 'linkedin', 'twitter', 'instagram', 'whatsapp', 'telegram', 'githubUsername', 'thmUsername'].forEach(
    (f) => {
      if (req.body[f] !== undefined) s[f] = req.body[f];
    }
  );
  if (req.file) s.profilePhoto = toDataUrl(req.file);

  // custom social links (label + url pairs)
  const labels = [].concat(req.body['custom_label'] || []);
  const urls = [].concat(req.body['custom_url'] || []);
  s.customLinks = labels
    .map((label, i) => ({ label: (label || '').trim(), url: (urls[i] || '').trim() }))
    .filter((l) => l.label && l.url);

  await s.save();
  res.redirect(go('/admin/settings?saved=1'));
});

// ---------- resume / CV upload ----------
router.post('/resume', resumeUpload.single('resume'), async (req, res) => {
  if (!req.file) return res.redirect(go('/admin/settings?resume_error=1'));
  const s = await SiteSetting.get();
  s.resumeFile = `data:application/pdf;base64,${req.file.buffer.toString('base64')}`;
  s.resumeName = req.file.originalname.endsWith('.pdf') ? req.file.originalname : req.file.originalname + '.pdf';
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
  const editService = req.query.edit ? await Service.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/services', { services: await Service.find().sort({ createdAt: 1 }), editService });
});

router.post('/services', async (req, res) => {
  const { title, description, price } = req.body;
  if (title && title.trim()) await Service.create({ title: title.trim(), description, price });
  res.redirect(go('/admin/services'));
});

router.post('/services/:id/update', async (req, res) => {
  const { title, description, price } = req.body;
  if (title && title.trim()) {
    await Service.findByIdAndUpdate(req.params.id, { title: title.trim(), description, price }).catch(() => {});
  }
  res.redirect(go('/admin/services'));
});

router.post('/services/:id/delete', async (req, res) => {
  await Service.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect(go('/admin/services'));
});

// ---------- testimonials ----------
router.get('/testimonials', async (req, res) => {
  const editTestimonial = req.query.edit ? await Testimonial.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/testimonials', { testimonials: await Testimonial.find().sort({ createdAt: -1 }), editTestimonial });
});

router.post('/testimonials', async (req, res) => {
  const { name, company, text, rating } = req.body;
  if (name && name.trim() && text && text.trim()) {
    await Testimonial.create({
      name: name.trim(),
      company: company || '',
      text: text.trim(),
      rating: Math.min(5, Math.max(1, parseInt(rating, 10) || 5)),
    });
  }
  res.redirect(go('/admin/testimonials'));
});

router.post('/testimonials/:id/update', async (req, res) => {
  const { name, company, text, rating } = req.body;
  if (name && name.trim() && text && text.trim()) {
    await Testimonial.findByIdAndUpdate(req.params.id, {
      name: name.trim(),
      company: company || '',
      text: text.trim(),
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
  const editExp = req.query.edit ? await Experience.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/experience', { experience: await Experience.find().sort({ current: -1, order: 1, createdAt: -1 }), editExp });
});

router.post('/experience', async (req, res) => {
  const { company, role, duration, description, order } = req.body;
  if (company && company.trim() && role && role.trim()) {
    await Experience.create({
      company: company.trim(),
      role: role.trim(),
      duration: duration || '',
      description: description || '',
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
      company: company.trim(),
      role: role.trim(),
      duration: duration || '',
      description: description || '',
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
  const editLab = req.query.edit ? await Lab.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/labs', { labs: await Lab.find().sort({ createdAt: -1 }), editLab });
});

router.post('/labs', async (req, res) => {
  const { platform, title, category, difficulty, url, solvedAt } = req.body;
  if (title && title.trim()) {
    await Lab.create({
      platform: platform || 'TryHackMe',
      title: title.trim(),
      category: (category || 'General').trim(),
      difficulty: difficulty || 'Easy',
      url: url || '',
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
      title: title.trim(),
      category: (category || 'General').trim(),
      difficulty: difficulty || 'Easy',
      url: url || '',
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
  // BUGFIX: Mongo alphabetical sort status:1 se approved pehle aata tha — pending first chahiye
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
  // reply set karo; khaali submit = reply clear (taaki galti se reply hata sake)
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
  const editSkill = req.query.edit ? await Skill.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/skills', { skills: await Skill.find().sort({ category: 1, level: -1 }), editSkill });
});

router.post('/skills', async (req, res) => {
  const { name, level, category } = req.body;
  if (name && name.trim()) {
    await Skill.create({
      name: name.trim(),
      level: Math.min(100, Math.max(0, parseInt(level, 10) || 80)),
      category: (category || 'General').trim(),
    });
  }
  res.redirect(go('/admin/skills'));
});

router.post('/skills/:id/update', async (req, res) => {
  const { name, level, category } = req.body;
  if (name && name.trim()) {
    await Skill.findByIdAndUpdate(req.params.id, {
      name: name.trim(),
      level: Math.min(100, Math.max(0, parseInt(level, 10) || 80)),
      category: (category || 'General').trim(),
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
  if (title && title.trim()) {
    await Project.create({
      title: title.trim(),
      description,
      techStack,
      liveUrl,
      githubUrl,
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
  const p = await Project.findById(req.params.id);
  if (!p) return res.redirect(go('/admin/projects'));
  Object.assign(p, {
    title: req.body.title,
    description: req.body.description,
    techStack: req.body.techStack,
    liveUrl: req.body.liveUrl,
    githubUrl: req.body.githubUrl,
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
  if (name && name.trim()) {
    await Tool.create({
      name: name.trim(),
      description,
      category: category || 'Other',
      price,
      demoUrl,
      buyUrl,
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
  const t = await Tool.findById(req.params.id);
  if (!t) return res.redirect(go('/admin/tools'));
  Object.assign(t, {
    name: req.body.name,
    description: req.body.description,
    category: req.body.category,
    price: req.body.price,
    demoUrl: req.body.demoUrl,
    buyUrl: req.body.buyUrl,
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
