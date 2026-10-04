/**
 * Seed users — create/update the two login accounts:
 *   1. sudhanshu  → role 'admin'  (panel access ONLY for this username)
 *   2. visitor    → role 'user'   (normal login, naam site pe dikhta hai)
 *
 * Run:  node scripts/seed-users.js
 * Idempotent — safe to run again (updates password + role, keeps email/OTP fields).
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDB } = require('../db');
const { AdminUser } = require('../models');

const USERS = [
  {
    username: 'sudhanshu',
    password: 'Sudhanshu@Admin#2025',
    role: 'admin',
  },
  {
    username: 'visitor',
    password: 'Visitor@2025',
    role: 'user',
  },
];

(async () => {
  await initDB();
  for (const u of USERS) {
    const hash = await bcrypt.hash(u.password, 12);
    const existing = await AdminUser.findOne({ username: u.username });
    if (existing) {
      existing.passwordHash = hash;
      existing.role = u.role;
      await existing.save();
      console.log(`✅ updated: ${u.username} (role=${u.role})`);
    } else {
      await AdminUser.create({
        username: u.username,
        passwordHash: hash,
        role: u.role,
        email: '',
      });
      console.log(`✅ created: ${u.username} (role=${u.role})`);
    }
  }
  const all = await AdminUser.find({}, 'username role email').lean();
  console.log('\nCurrent users in DB:');
  all.forEach((x) => console.log(`  - ${x.username}  role=${x.role}  email=${x.email || '(none)'}`));
  process.exit(0);
})().catch((e) => {
  console.error('Seed failed:', e.message);
  process.exit(1);
});
