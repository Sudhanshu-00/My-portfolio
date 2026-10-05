/**
 * Seed users — create/update the two login accounts:
 *   1. sudhanshu → role 'user'  (normal login at /login → /user/sudhanshu dashboard)
 *   2. admin     → role 'admin' (gated login at /user/sudhanshu/admin/login → secret panel)
 *
 * Also removes obsolete 'visitor' account.
 * Run:  node scripts/seed-users.js   (idempotent)
 */
require('../lib/env'); // .env + ~/.my-portfolio.env fallback chain
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { initDB } = require('../db');
const { AdminUser } = require('../models');

// ⚠️  Koi password yahan hardcoded NAHI — env se aata hai (OWNER_PASS / ADMIN_PASS),
//     warna random generate hota hai aur sirf EK BAAR print hota hai.
//     Re-run seed → DB passwords in env values se overwrite honge (idempotent reset).
const randPass = () => crypto.randomBytes(12).toString('base64url');

const USERS = [
  {
    username: 'sudhanshu',
    password: process.env.OWNER_PASS || randPass(),
    role: 'user',
  },
  {
    username: 'admin',
    password: process.env.ADMIN_PASS || randPass(),
    role: 'admin',
    email: process.env.ADMIN_EMAIL || '',
  },
];
const REMOVE = ['visitor']; // obsolete accounts

(async () => {
  await initDB();
  // random-generated passwords → OWNER (ADMIN_EMAIL) ko email, console pe sirf fallback
  const { sendCredentials, mailReady } = require('../services/mailer');
  for (const u of USERS) {
    const fromEnv = u.username === 'admin' ? process.env.ADMIN_PASS : process.env.OWNER_PASS;
    if (!fromEnv && process.env.ADMIN_EMAIL && mailReady()) {
      const ok = await sendCredentials({ to: process.env.ADMIN_EMAIL, username: u.username, password: u.password, context: `seed script — ${u.username} (${u.role})` }).catch(() => false);
      if (ok) console.log(`📧 ${u.username} → generated credentials emailed to ${process.env.ADMIN_EMAIL}`);
      else console.log(`🔑 ${u.username} → generated password (email fail — save it now!): ${u.password}`);
    } else if (!fromEnv) {
      console.log(`🔑 ${u.username} → generated password (email nahi bhej sakte${process.env.ADMIN_EMAIL ? ' — mail transport off' : ' — ADMIN_EMAIL not set'} — save it now!): ${u.password}`);
    }
  }
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 12);
    const existing = await AdminUser.findOne({ username: u.username });
    if (existing) {
      existing.passwordHash = hash;
      existing.role = u.role;
      if (u.email) existing.email = u.email;
      await existing.save();
      console.log(`✅ updated: ${u.username} (role=${u.role})`);
    } else {
      await AdminUser.create({
        username: u.username,
        passwordHash: hash,
        role: u.role,
        email: u.email || '',
      });
      console.log(`✅ created: ${u.username} (role=${u.role})`);
    }
  }
  for (const r of REMOVE) {
    const out = await AdminUser.deleteOne({ username: r });
    if (out.deletedCount) console.log(`🗑️  removed obsolete account: ${r}`);
  }
  const all = await AdminUser.find({}, 'username role email').lean();
  console.log('\nCurrent users in DB:');
  all.forEach((x) => console.log(`  - ${x.username}  role=${x.role}  email=${x.email || '(none)'}`));
  process.exit(0);
})().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
