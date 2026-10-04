const router = require('express').Router();
const { Project, Skill, Message, Tool, Service, Testimonial, Experience, Lab, Feedback, SiteSetting } = require('../models');
const { getRepoDetails, getProfile, mdToHtml } = require('../services/github');

router.get('/', async (req, res) => {
  const [projects, skills, tools, services, testimonials] = await Promise.all([
    Project.find().sort({ featured: -1, createdAt: -1 }),
    Skill.find().sort({ category: 1, level: -1 }),
    Tool.find().sort({ featured: -1, createdAt: -1 }),
    Service.find().sort({ createdAt: 1 }),
    Testimonial.find().sort({ createdAt: -1 }),
  ]);
  res.render('home', { projects, skills, tools, services, testimonials });
});

// Resume / CV download
router.get('/resume', async (req, res) => {
  try {
    const s = await SiteSetting.get();
    if (!s.resumeFile) return res.status(404).render('404');
    const [meta, b64] = String(s.resumeFile).split(',');
    const mime = (String(meta).match(/data:([^;]+);/) || [])[1] || 'application/pdf';
    const name = (s.resumeName || 'resume.pdf').replace(/[^\w.\- ]/g, '') || 'resume.pdf';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(Buffer.from(b64, 'base64'));
  } catch {
    res.status(404).render('404');
  }
});

router.get('/about', async (req, res) => {
  const [gh, experience] = await Promise.all([
    getProfile(res.locals.settings.githubUsername || 'Sudhanshu-00').catch(() => ({ ok: false })),
    Experience.find().sort({ current: -1, order: 1, createdAt: -1 }),
  ]);
  res.render('about', { gh, experience });
});

router.get('/tools', async (req, res) => {
  const tools = await Tool.find().sort({ featured: -1, createdAt: -1 });
  res.render('tools', { tools });
});

router.get('/tools/:id', async (req, res) => {
  try {
    const tool = await Tool.findById(req.params.id);
    if (!tool) return res.status(404).render('404');
    res.render('tool', { tool });
  } catch {
    res.status(404).render('404');
  }
});

router.get('/projects', async (req, res) => {
  const projects = await Project.find().sort({ createdAt: -1 });
  res.render('projects', { projects });
});

router.get('/projects/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).render('404');
    const gh = project.githubUrl ? await getRepoDetails(project.githubUrl) : { ok: false, reason: 'no-github-url' };
    res.render('project', { project, gh, readmeHtml: gh.ok ? mdToHtml(gh.readme) : '' });
  } catch {
    res.status(404).render('404');
  }
});

// Labs & practice grounds (TryHackMe / PortSwigger)
router.get('/labs', async (req, res) => {
  const labs = await Lab.find().sort({ solvedAt: -1, createdAt: -1 });
  res.render('labs', { labs });
});

// ---- Feedback (public) ----
router.get('/feedback', async (req, res) => {
  const approved = await Feedback.find({ status: 'approved' }).sort({ createdAt: -1 }).limit(50);
  res.render('feedback', { approved, query: req.query });
});

router.post('/feedback', async (req, res) => {
  // honeypot: bots fill the 'website' field → show quiet success
  if (req.body.website) return res.redirect('/feedback?sent=1');

  const { name, email, rating, message } = req.body;
  const cleanName = String(name || '').trim().slice(0, 60);
  const cleanMsg = String(message || '').trim().slice(0, 1000);
  const rate = Math.min(5, Math.max(1, parseInt(rating, 10) || 5));

  if (!cleanName || !cleanMsg) return res.redirect('/feedback?error=1');

  // BUGFIX: trust proxy=1 means X-Forwarded-For could be spoofed to bypass the per-IP limit —
  // a global flood-cap is applied as well (max 20 submissions site-wide per 10 min)
  const flood = await Feedback.countDocuments({ createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) } }).catch(() => 0);
  if (flood >= 20) return res.redirect('/feedback?error=rate');

  // rate limit: one feedback per IP per 2 min
  const recent = await Feedback.countDocuments({ ip: req.ip, createdAt: { $gte: new Date(Date.now() - 2 * 60 * 1000) } }).catch(() => 0);
  if (recent > 0) return res.redirect('/feedback?error=rate');

  await Feedback.create({ name: cleanName, email: String(email || '').trim().slice(0, 100), rating: rate, message: cleanMsg, ip: req.ip }).catch(() => {});
  res.redirect('/feedback?sent=1');
});

router.get('/contact', (req, res) => res.render('contact', { query: req.query }));

router.post('/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message || !/\S+@\S+\.\S+/.test(email)) {
    return res.redirect('/contact?error=1');
  }
  // rate limit: one message per IP per 2 min (spam protection)
  const recent = await Message.countDocuments({ ip: req.ip, createdAt: { $gte: new Date(Date.now() - 2 * 60 * 1000) } }).catch(() => 0);
  if (recent > 0) return res.redirect('/contact?error=rate');
  await Message.create({
    name: String(name).trim().slice(0, 60),
    email: String(email).trim().slice(0, 100),
    message: String(message).trim().slice(0, 2000),
    ip: req.ip,
  });
  res.redirect('/contact?sent=1');
});

module.exports = router;
