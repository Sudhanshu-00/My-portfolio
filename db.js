const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

let activeUri = process.env.MONGODB_URI || '';

async function initDB() {
  if (!activeUri) {
    console.log('⚠️  MONGODB_URI not set → starting local IN-MEMORY MongoDB (dev only, data resets on restart)');
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const mem = await MongoMemoryServer.create();
    activeUri = mem.getUri('portfolio');
  }

  await mongoose.connect(activeUri, { dbName: 'portfolio' });
  console.log('✅ MongoDB connected');
  await seed();
}

async function seed() {
  const { AdminUser, SiteSetting, Skill, Project } = require('./models');

  // Default admin user
  if ((await AdminUser.countDocuments()) === 0) {
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASS || 'admin@123';
    await AdminUser.create({ username, passwordHash: await bcrypt.hash(password, 10) });
    console.log(`👑 Admin created → login: ${username} / ${password}  (change password after first login!)`);
  }

  // Default settings
  await SiteSetting.get();

  // Sample content (only on first run, admin can delete later)
  if ((await Skill.countDocuments()) === 0) {
    await Skill.create([
      { name: 'HTML', level: 90, category: 'Frontend' },
      { name: 'CSS', level: 85, category: 'Frontend' },
      { name: 'JavaScript', level: 80, category: 'Frontend' },
      { name: 'Node.js', level: 70, category: 'Backend' },
    ]);
  }

  if ((await Project.countDocuments()) === 0) {
    const svg = (t, c1, c2) =>
      'data:image/svg+xml;base64,' +
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/><text x="400" y="260" font-family="Arial" font-size="40" fill="#fff" text-anchor="middle">${t}</text></svg>`
      ).toString('base64');

    await Project.create([
      {
        title: 'Portfolio Website',
        description: 'My personal portfolio website built with HTML, CSS and JavaScript. Fully responsive design.',
        techStack: 'HTML, CSS, JavaScript',
        image: svg('Portfolio Website', '#6366f1', '#38bdf8'),
        featured: true,
      },
      {
        title: 'Todo App',
        description: 'A simple todo application with add, edit, delete and mark-complete features.',
        techStack: 'React, Node.js, MongoDB',
        image: svg('Todo App', '#f59e0b', '#ef4444'),
        featured: true,
      },
    ]);
  }
}

module.exports = { initDB, getActiveUri: () => activeUri };
