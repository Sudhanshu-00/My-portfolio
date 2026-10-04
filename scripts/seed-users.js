/**
 * Seed users — create/update the two login accounts:
 *   1. sudhanshu → role 'user'  (normal login at /login → /user/sudhanshu dashboard)
 *   2. admin     → role 'admin' (gated login at /user/sudhanshu/admin/login → secret panel)
 *
 * Also removes obsolete 'visitor' account.
 * Run:  node scripts/seed-users.js   (idempotent)
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDB } = require('../db');
const { AdminUser } = require('../models');

const USERS = [
  {
    username: 'sudhanshu',
    password: 'Sudhanshu@2025',
    role: 'user',
  },
  {
    username: 'admin',
    password: 'Sudhanshu@Admin#2025',
    role: 'admin',
    email: process.env.ADMIN_EMAIL || '',
  },
];
const REMOVE = ['visitor']; // obsolete accounts

(async () => {
  await initDB();
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
