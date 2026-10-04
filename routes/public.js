const router = require('express').Router();
const { Project, Skill, Message } = require('../models');

router.get('/', async (req, res) => {
  const [projects, skills] = await Promise.all([
    Project.find().sort({ featured: -1, createdAt: -1 }).limit(6),
    Skill.find().sort({ level: -1 }).limit(8),
  ]);
  res.render('home', { projects, skills });
});

router.get('/about', (req, res) => res.render('about'));

router.get('/projects', async (req, res) => {
  const projects = await Project.find().sort({ createdAt: -1 });
  res.render('projects', { projects });
});

router.get('/projects/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).render('404');
    res.render('project', { project });
  } catch {
    res.status(404).render('404');
  }
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
