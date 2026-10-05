// lib/env.js — env loading with secure fallback chain (koi credential hardcoded NAHI)
//
// Load order (pehla available hi jeet-ta hai, missing keys hi fill hoti hain):
//   1) process.env            → hosting dashboard (Render env vars) — highest priority
//   2) <project>/.env         → normal local setup
//   3) ~/.my-portfolio.env    → RECOVERY copy — repo ke BAHAR (home dir), isliye:
//        - git me kabhi commit nahi hoti
//        - project folder delete + re-clone hone par bhi bachti rehti hai
//        - .env delete ho jaye to app isi se Atlas URI + SMTP creds utha leta hai
//
// Source code me koi secret nahi — ye file sirf PATH jaanti hai, values nahi.
const fs = require('fs');
const path = require('path');
const os = require('os');

// 1) + 2) project .env (dotenv cwd se)
require('dotenv').config();

// 3) recovery fallback — sirf tab jab .env missing ho YA critical keys adhoori hon
const HOME_ENV = path.join(os.homedir(), '.my-portfolio.env');
const CRITICAL_KEYS = ['MONGODB_URI', 'SESSION_SECRET'];
const envFile = path.join(process.cwd(), '.env');
const needsFallback = !fs.existsSync(envFile) || CRITICAL_KEYS.some((k) => !process.env[k]);

if (needsFallback && fs.existsSync(HOME_ENV)) {
  require('dotenv').config({ path: HOME_ENV }); // dotenv default: existing keys override NAHI karta
  const reason = fs.existsSync(envFile) ? 'incomplete (critical keys missing)' : 'missing';
  console.warn(`⚠️  .env ${reason} → recovery config loaded from ${HOME_ENV}`);
  console.warn('    Restore the project .env (from .env.backup ya hosting dashboard) to silence this.');
}
