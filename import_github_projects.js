/**
 * One-time importer: pulls your real GitHub projects into the portfolio DB
 * with clean English descriptions. Safe to re-run (upserts by title).
 *   Usage: node import_github_projects.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Project } = require('./models');

const svg = (t, c1, c2) =>
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/><text x="400" y="260" font-family="monospace" font-size="38" fill="#fff" text-anchor="middle">${t}</text></svg>`
  ).toString('base64');

const G = 'https://github.com/Sudhanshu-00';

// Fake seed samples that must be replaced with real work
const REMOVE = ['E-commerce Pentest', 'Android APK Audit'];

const PROJECTS = [
  {
    title: 'MCA Web Scanning Toolkit',
    description:
      'All-in-one cybersecurity & web scanning toolkit — 5+ modules with 60+ tools, the ReconX recon suite and a Payload Lab with 528+ payloads, all behind a single entry point.',
    techStack: 'Python, Web Recon, OSINT, Payload Lab',
    image: svg('MCA Web Scanner', '#0f5132', '#00ff41'),
    githubUrl: `${G}/MCA-WEB-SCANING`,
    featured: true,
  },
  {
    title: 'Pentesting Toolkit v3.0',
    description:
      'Automated security-testing toolkit with two modes: a browser-based Web Recon Dashboard and a classic CLI with 14 recon modules plus a full payload arsenal.',
    techStack: 'Python, Recon Dashboard, CLI, Payloads',
    image: svg('Pentesting Toolkit', '#3b0764', '#00e5ff'),
    githubUrl: `${G}/Pentesting`,
    featured: true,
  },
  {
    title: 'Web Shell & Payload Collection',
    description:
      'Curated web-shell and payload collection built for educational, blue-team and authorized-pentest use — understand how webshells work so you can detect and defend against them.',
    techStack: 'Web Shells, Payloads, Blue Team, Red Team',
    image: svg('Payload Collection', '#450a0a', '#ffd60a'),
    githubUrl: `${G}/payload`,
    featured: true,
  },
  {
    title: 'Personal Portfolio (This Website)',
    description:
      'The site you are browsing — a fully dynamic portfolio with an admin panel: projects, tools shop, skills, testimonials, resume download, visitor analytics and SEO, all managed from the dashboard.',
    techStack: 'Node.js, Express, EJS, MongoDB, Session Auth',
    image: svg('This Portfolio', '#052e12', '#00ff41'),
    githubUrl: `${G}/My-portfolio`,
    featured: true,
  },
  {
    title: 'MERN Stack Portfolio',
    description:
      'Earlier MERN-stack version of my portfolio — React front end with an Express + MongoDB backend exposing REST APIs for all portfolio content.',
    techStack: 'MongoDB, Express, React, Node.js',
    image: svg('MERN Portfolio', '#0a2540', '#38bdf8'),
    githubUrl: `${G}/Mern-Portfolio`,
    featured: false,
  },
  {
    title: 'Job Portal (Full Stack)',
    description:
      'Full-stack job portal web application with a separated backend and frontend — job listings, applications and user management.',
    techStack: 'JavaScript, Node.js, Frontend + Backend',
    image: svg('Job Portal', '#14532d', '#a3e635'),
    githubUrl: `${G}/Job-portel`,
    featured: false,
  },
  {
    title: 'Annapurna — Food Ordering Microservices',
    description:
      '.NET microservices food-ordering solution (Mango): API Gateway, Auth, Product, Coupon, Order and ShoppingCart services plus a full admin panel.',
    techStack: 'C#, .NET, Microservices, REST APIs',
    image: svg('Annapurna Microservices', '#4c1d95', '#c084fc'),
    githubUrl: `${G}/Annapurna`,
    featured: false,
  },
  {
    title: 'Web Dev Project Collection',
    description:
      'A curated collection of web-development builds — Paytm-clone UI, landing pages, React apps, user-management module and multiple portfolio sites.',
    techStack: 'HTML, CSS, JavaScript, React',
    image: svg('Web Dev Collection', '#1e3a8a', '#60a5fa'),
    githubUrl: `${G}/All-Project`,
    featured: false,
  },
  {
    title: 'Cisco Networking Labs',
    description:
      'Hands-on Cisco Packet Tracer labs covering OSPF, EIGRP, VLANs, DHCP, IPv6, port security, router backups and multi-router topologies.',
    techStack: 'Cisco IOS, Packet Tracer, Routing, Switching',
    image: svg('Cisco Labs', '#0c4a6e', '#22d3ee'),
    githubUrl: `${G}/Cisco-project`,
    featured: false,
  },
  {
    title: 'CCNA & Linux Notes',
    description:
      'Structured study notes and reference material for CCNA networking concepts and Linux administration fundamentals.',
    techStack: 'CCNA, Linux, Networking, SysAdmin',
    image: svg('CCNA & Linux Notes', '#3f6212', '#bef264'),
    githubUrl: `${G}/file_lin_or_ccna`,
    featured: false,
  },
  {
    title: 'Linux Command Reference',
    description:
      'Personal Linux command handbook — soft/hard links, directory services and day-to-day administration commands with worked examples.',
    techStack: 'Linux, Bash, Shell Commands',
    image: svg('Linux Reference', '#171717', '#00ff41'),
    githubUrl: `${G}/Linux-command`,
    featured: false,
  },
  {
    title: 'Python Practice & SQL Server',
    description:
      'Python learning playground — OOP (classes, inheritance), core scripts and SQL Server integration experiments.',
    techStack: 'Python, OOP, SQL Server',
    image: svg('Python Practice', '#422006', '#facc15'),
    githubUrl: `${G}/python`,
    featured: false,
  },
];

(async () => {
  if (!process.env.MONGODB_URI) {
    console.error('❌ MONGODB_URI missing in .env');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGODB_URI, { dbName: 'portfolio' });
  console.log('✅ Connected to MongoDB');

  // 1) remove fake seed samples
  for (const t of REMOVE) {
    const r = await Project.deleteOne({ title: t });
    if (r.deletedCount) console.log(`🗑 Removed fake sample: ${t}`);
  }

  // 2) upsert real projects by title (no duplicates on re-run)
  let added = 0, updated = 0;
  for (const p of PROJECTS) {
    const r = await Project.updateOne({ title: p.title }, { $set: p }, { upsert: true });
    if (r.upsertedCount) { added++; console.log(`➕ Added: ${p.title}`); }
    else { updated++; console.log(`↻ Updated: ${p.title}`); }
  }

  const total = await Project.countDocuments();
  console.log(`\n📊 Done → ${added} added, ${updated} updated, total projects in DB: ${total}`);
  await mongoose.disconnect();
})().catch((e) => {
  console.error('Import failed:', e.message);
  process.exit(1);
});
