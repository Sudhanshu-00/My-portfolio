const router = require('express').Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { AdminUser, Project, Skill, Message, SiteSetting, Tool, PageView, Service, Testimonial, Experience } = require('../models');

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
    res.locals.path = req.path; // active sidebar highlight
    res.locals.unread = await Message.countDocuments({ read: false });
    return next();
  }
  res.redirect('/admin/login');
};

router.get('/login', (req, res) => (req.session.admin ? res.redirect('/admin') : res.render('admin/login', { error: null })));

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await AdminUser.findOne({ username });
  if (user && (await bcrypt.compare(password || '', user.passwordHash))) {
    req.session.admin = user.username;
    return res.redirect('/admin');
  }
  res.status(401).render('admin/login', { error: 'Invalid username or password' });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

// everything below requires login
router.use(requireAuth);

// ---------- dashboard ----------
router.get('/', async (req, res) => {
  const [projects, skills, unread, tools, services, testimonials, totalMsgs, totalViews, viewsToday] = await Promise.all([
    Project.countDocuments(),
    Skill.countDocuments(),
    Message.countDocuments({ read: false }),
    Tool.countDocuments(),
    Service.countDocuments(),
    Testimonial.countDocuments(),
    Message.countDocuments(),
    PageView.countDocuments(),
    PageView.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }),
  ]);

  // 7-day view chart
  const since7 = new Date(Date.now() - 6 * 864e5);
  since7.setHours(0, 0, 0, 0);
  const [dailyRaw, topPages, recent] = await Promise.all([
    PageView.aggregate([
      { $match: { createdAt: { $gte: since7 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
    ]),
    PageView.aggregate([{ $group: { _id: '$path', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]),
    Message.find().sort({ createdAt: -1 }).limit(4),
  ]);
  const dayMap = Object.fromEntries(dailyRaw.map((d) => [d._id, d.count]));
  const chart = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    const key = d.toISOString().slice(0, 10);
    chart.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short' }), count: dayMap[key] || 0 });
  }
  const maxCount = Math.max(1, ...chart.map((c) => c.count));

  res.render('admin/dashboard', {
    counts: { projects, skills, unread, tools, services, testimonials },
    stats: { totalMsgs, totalViews, viewsToday },
    chart,
    maxCount,
    topPages,
    recent,
  });
});

// ---------- settings ----------
router.get('/settings', (req, res) => res.render('admin/settings'));

router.post('/settings', upload.single('photo'), async (req, res) => {
  const s = await SiteSetting.get();
  ['siteName', 'heroTitle', 'heroSubtitle', 'aboutText', 'email', 'phone', 'location', 'github', 'linkedin', 'twitter', 'instagram', 'whatsapp', 'telegram', 'githubUsername'].forEach(
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
  res.redirect('/admin/settings?saved=1');
});

// ---------- resume / CV upload ----------
router.post('/resume', resumeUpload.single('resume'), async (req, res) => {
  if (!req.file) return res.redirect('/admin/settings?resume_error=1');
  const s = await SiteSetting.get();
  s.resumeFile = `data:application/pdf;base64,${req.file.buffer.toString('base64')}`;
  s.resumeName = req.file.originalname.endsWith('.pdf') ? req.file.originalname : req.file.originalname + '.pdf';
  await s.save();
  res.redirect('/admin/settings?resume=1');
});

router.post('/resume/delete', async (req, res) => {
  const s = await SiteSetting.get();
  s.resumeFile = '';
  s.resumeName = 'resume.pdf';
  await s.save();
  res.redirect('/admin/settings?resume_deleted=1');
});

// ---------- services (hire me) ----------
router.get('/services', async (req, res) => {
  const editService = req.query.edit ? await Service.findById(req.query.edit).catch(() => null) : null;
  res.render('admin/services', { services: await Service.find().sort({ createdAt: 1 }), editService });
});

router.post('/services', async (req, res) => {
  const { title, description, price } = req.body;
  if (title && title.trim()) await Service.create({ title: title.trim(), description, price });
  res.redirect('/admin/services');
});

router.post('/services/:id/update', async (req, res) => {
  const { title, description, price } = req.body;
  if (title && title.trim()) {
    await Service.findByIdAndUpdate(req.params.id, { title: title.trim(), description, price }).catch(() => {});
  }
  res.redirect('/admin/services');
});

router.post('/services/:id/delete', async (req, res) => {
  await Service.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect('/admin/services');
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
  res.redirect('/admin/testimonials');
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
  res.redirect('/admin/testimonials');
});

router.post('/testimonials/:id/delete', async (req, res) => {
  await Testimonial.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect('/admin/testimonials');
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
  res.redirect('/admin/experience');
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
  res.redirect('/admin/experience');
});

router.post('/experience/:id/delete', async (req, res) => {
  await Experience.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect('/admin/experience');
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
  res.redirect('/admin/skills');
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
  res.redirect('/admin/skills');
});

router.post('/skills/:id/delete', async (req, res) => {
  await Skill.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect('/admin/skills');
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
  res.redirect('/admin/projects');
});

router.get('/projects/:id/edit', async (req, res) => {
  const project = await Project.findById(req.params.id);
  if (!project) return res.redirect('/admin/projects');
  res.render('admin/project_form', { project });
});

router.post('/projects/:id', upload.single('image'), async (req, res) => {
  const p = await Project.findById(req.params.id);
  if (!p) return res.redirect('/admin/projects');
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
  res.redirect('/admin/projects');
});

router.post('/projects/:id/delete', async (req, res) => {
  await Project.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect('/admin/projects');
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
  res.redirect('/admin/tools');
});

router.get('/tools/:id/edit', async (req, res) => {
  const tool = await Tool.findById(req.params.id);
  if (!tool) return res.redirect('/admin/tools');
  res.render('admin/tool_form', { tool });
});

router.post('/tools/:id', upload.single('image'), async (req, res) => {
  const t = await Tool.findById(req.params.id);
  if (!t) return res.redirect('/admin/tools');
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
  res.redirect('/admin/tools');
});

router.post('/tools/:id/delete', async (req, res) => {
  await Tool.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect('/admin/tools');
});

// ---------- messages ----------
router.get('/messages', async (req, res) => {
  res.render('admin/messages', { messages: await Message.find().sort({ createdAt: -1 }) });
});

router.post('/messages/:id/read', async (req, res) => {
  await Message.findByIdAndUpdate(req.params.id, { read: true }).catch(() => {});
  res.redirect('/admin/messages');
});

router.post('/messages/:id/delete', async (req, res) => {
  await Message.findByIdAndDelete(req.params.id).catch(() => {});
  res.redirect('/admin/messages');
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
