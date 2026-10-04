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

  // admin email backfill (forgot-password OTP goes to this address)
  // updateMany → EVERY account without an email gets it (signup always collects a
  // verified email, so in practice only seeded accounts are touched — this makes
  // password recovery work for the owner's user account too, not just 'admin').
  if (process.env.ADMIN_EMAIL) {
    const { AdminUser } = require('./models');
    await AdminUser.updateMany({ email: { $in: [null, ''] } }, { email: process.env.ADMIN_EMAIL }).catch(() => {});
  }
}

const svg = (t, c1, c2) =>
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/><text x="400" y="260" font-family="monospace" font-size="40" fill="#fff" text-anchor="middle">${t}</text></svg>`
  ).toString('base64');

async function seed() {
  const { AdminUser, SiteSetting, Skill, Project, Tool, Service, Testimonial } = require('./models');

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
      { name: 'Penetration Testing', level: 90, category: 'Offensive' },
      { name: 'Android Pentesting', level: 85, category: 'Offensive' },
      { name: 'Web App Hacking', level: 88, category: 'Offensive' },
      { name: 'Python / Bash', level: 80, category: 'Automation' },
    ]);
  }

  if ((await Project.countDocuments()) === 0) {
    await Project.create([
      {
        title: 'E-commerce Pentest',
        description: 'Full black-box penetration test of an e-commerce platform — found SQLi, IDOR & payment logic flaws. Clean report delivered.',
        techStack: 'Burp Suite, SQLMap, Nmap',
        image: svg('E-commerce Pentest', '#0f5132', '#00ff41'),
        featured: true,
      },
      {
        title: 'Android APK Audit',
        description: 'Reverse-engineered and audited a fintech APK — hardcoded secrets, insecure storage & weak SSL pinning bypass.',
        techStack: 'MobSF, Frida, jadx',
        image: svg('Android APK Audit', '#3b0764', '#00e5ff'),
        featured: true,
      },
    ]);
  }

  if ((await Tool.countDocuments()) === 0) {
    await Tool.create([
      {
        name: 'APKSentinel',
        category: 'Android',
        price: '₹1,999',
        description: 'Automated Android app pentesting toolkit — decompile APK, static analysis, hardcoded secrets, insecure exports & SSL pinning checks in one command.',
        image: svg('APKSentinel', '#0f5132', '#00ff41'),
        featured: true,
      },
      {
        name: 'WebVulnX',
        category: 'Web',
        price: '₹1,499',
        description: 'Web application vulnerability scanner — SQLi, XSS, IDOR & 30+ security checks with clean PDF report output.',
        image: svg('WebVulnX', '#3b0764', '#00e5ff'),
        featured: true,
      },
      {
        name: 'NetSweep',
        category: 'Network',
        price: '₹999',
        description: 'Fast network reconnaissance toolkit — host discovery, port scanning & service fingerprinting in seconds.',
        image: svg('NetSweep', '#450a0a', '#ffd60a'),
      },
    ]);
  }

  if ((await Service.countDocuments()) === 0) {
    await Service.create([
      {
        title: 'Web App Penetration Test',
        price: '₹4,999+',
        description: 'Full OWASP Top 10 black-box testing of your website — SQLi, XSS, IDOR, auth bypass — with detailed PDF report + free retest.',
      },
      {
        title: 'Android App Security Audit',
        price: '₹5,999+',
        description: 'APK reverse engineering, static + dynamic analysis, hardcoded secrets, insecure storage & SSL pinning checks with clean report.',
      },
      {
        title: 'Security Tool Development',
        price: 'Custom',
        description: 'Custom Python/Bash automation tools, scrapers, recon & offensive-security scripts built exactly to your requirements.',
      },
    ]);
  }

  if ((await Testimonial.countDocuments()) === 0) {
    await Testimonial.create([
      {
        name: 'Rahul Sharma',
        company: 'ShopKart India',
        text: 'Found a critical SQLi in our checkout flow within 2 days. Report was clean and fix guidance was spot on. Highly recommended!',
        rating: 5,
      },
      {
        name: 'Priya Verma',
        company: 'FinTech Startup',
        text: 'Got our Android app audited before launch. Honest pricing, fast turnaround and a very detailed report. Will hire again.',
        rating: 5,
      },
      {
        name: 'Aman Gupta',
        company: 'Freelance Client',
        text: 'Built a custom recon tool for my team that saves hours every week. Great communication throughout the project.',
        rating: 4,
      },
    ]);
  }
}

module.exports = { initDB, getActiveUri: () => activeUri };
