// Single source of truth for the secret admin mount path.
// NEVER falls back to the guessable 'admin' — if ADMIN_PATH env is unset (or
// set to 'admin'), a random path is generated once per boot and logged, so the
// panel is never exposed at a predictable URL. server.js and routes/admin.js
// both require this module, so they always agree on the same path.
require('./lib/env'); // .env missing ho to ~/.my-portfolio.env recovery config
const crypto = require('crypto');

let ADMIN_PATH = String(process.env.ADMIN_PATH || '').replace(/^\/+|\/+$/g, '');
if (!ADMIN_PATH || ADMIN_PATH === 'admin') {
  ADMIN_PATH = crypto.randomBytes(12).toString('hex');
  console.warn(`⚠️  ADMIN_PATH env not set (or set to 'admin') — random panel path generated: /${ADMIN_PATH}`);
  console.warn('    Set ADMIN_PATH in your hosting environment variables to keep this path stable.');
}

module.exports = ADMIN_PATH;
