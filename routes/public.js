const router = require('express').Router();
const { Project, Skill, Message, Tool, Service, Testimonial, Experience, Lab, SiteSetting } = require('../models');
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

router.get('/contact', (req, res) => res.render('contact', { query: req.query }));

router.post('/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message || !/\S+@\S+\.\S+/.test(email)) {
    return res.redirect('/contact?error=1');
  }
  await Message.create({ name, email, message });
  res.redirect('/contact?sent=1');
});

module.exports = router;
