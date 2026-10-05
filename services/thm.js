// services/thm.js — TryHackMe stats auto-sync + dynamic SVG card
//
// THM ka official API bot-protected hai (Vercel checkpoint), isliye:
//   r.jina.ai proxy (real browser render) → profile text → regex parse → DB
//
// Flow:
//   - boot +5s: background sync (page-load block nahi hota)
//   - har 6h auto-sync
//   - /img/thm-card.svg request pe agar data 1h+ purana → background re-sync
//     (response turant last-known values se jata hai — kabhi hang nahi hota)
//   - fetch fail → last known values chalte rehte hain, card kabhi khaali nahi

const { SiteSetting } = require('../models');

const JINA_URL = 'https://r.jina.ai/https://tryhackme.com/p/';
const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;      // 6h — routine refresh
const STALE_ON_DEMAND_MS = 60 * 60 * 1000;     // 1h — page-load par bhi refresh try
const FETCH_TIMEOUT = 60 * 1000;

// fallback values (last verified: Oct 5) — DB kabhi khaali ho to bhi card dikhega
const DEFAULTS = {
  username: 'rsudhanshu.in.in',
  points: 49,
  level: '[0x9][MAGE]',
  rankPct: 'top 5%',
  rankNum: 136933,
  badges: 18,
  streak: 376,
  rooms: 91,
  syncedAt: null,
};

const state = { started: false, syncing: false, lastAt: 0, lastError: '', data: null };

// ---------- parser ----------
function parseProfile(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim());
  const out = {};
  let sawUsername = false;
  let prevNumeric = null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // NOTE: profile text me username pehle aata hai, level baad me — koi sawUsername guard nahi
    if (/^\[[0-9a-z]+x[0-9a-z]+\]\[[^\]]+\]$/i.test(l) && !out.level) out.level = l;
    if (/^top \d+%$/i.test(l)) out.rankPct = l;
    if (/^Rank$/i.test(l)) {
      const n = parseInt(lines[i + 1], 10);
      if (Number.isFinite(n)) out.rankNum = n;
    }
    if (/^Badges$/i.test(l) && out.badges === undefined) {
      const n = parseInt(lines[i + 1], 10);
      if (Number.isFinite(n)) out.badges = n;
    }
    if (/^Streak$/i.test(l)) {
      const n = parseInt(lines[i + 1], 10);
      if (Number.isFinite(n)) out.streak = n;
    }
    if (/^Completed rooms$/i.test(l) && out.rooms === undefined) {
      const n = parseInt(lines[i + 1], 10);
      if (Number.isFinite(n)) out.rooms = n;
    }
    if (/^\d{1,5}$/.test(l) && prevNumeric === null) prevNumeric = parseInt(l, 10);
    if (l && !out.username && /^[a-z0-9._-]+$/i.test(l) && l.includes('.')) {
      // username jaise "rsudhanshu.in.in" — pehla dotted lowercase token
      out.username = l;
      out.points = prevNumeric;
      sawUsername = true;
    }
  }

  // sanity: kam se kam streak/rooms valid hone chahiye
  if (!Number.isFinite(out.streak) || !Number.isFinite(out.rooms)) return null;
  return out;
}

// ---------- fetch + save ----------
async function sync(manual = false) {
  if (state.syncing) return { ok: false, reason: 'already-running' };
  state.syncing = true;
  try {
    const username = (await SiteSetting.get()).thmUsername || DEFAULTS.username;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    let text;
    try {
      const r = await fetch(JINA_URL + username, {
        signal: ctrl.signal,
        headers: { 'X-Return-Format': 'text', 'X-Timeout': '45' },
      });
      if (!r.ok) throw new Error('jina HTTP ' + r.status);
      text = await r.text();
    } finally {
      clearTimeout(t);
    }

    const parsed = parseProfile(text);
    if (!parsed) throw new Error('parse fail — stats nahi mile');

    const stats = {
      username: parsed.username || username,
      points: Number.isFinite(parsed.points) ? parsed.points : DEFAULTS.points,
      level: parsed.level || DEFAULTS.level,
      rankPct: parsed.rankPct || DEFAULTS.rankPct,
      rankNum: parsed.rankNum || DEFAULTS.rankNum,
      badges: parsed.badges ?? DEFAULTS.badges,
      streak: parsed.streak,
      rooms: parsed.rooms,
      syncedAt: new Date(),
    };

    await SiteSetting.updateOne({}, { $set: { thmStats: stats } });
    state.data = stats;
    state.lastAt = Date.now();
    state.lastError = '';
    console.log(`[THM] synced — streak ${stats.streak}d, rooms ${stats.rooms}, rank ${stats.rankPct} #${stats.rankNum}`);
    return { ok: true, stats };
  } catch (e) {
    state.lastError = String((e && e.message) || e).slice(0, 80);
    state.lastAt = Date.now();
    console.warn('[THM] sync fail:', state.lastError, '— last-known values chal rahe hain');
    return { ok: false, error: state.lastError };
  } finally {
    state.syncing = false;
  }
}

// ---------- public ----------
async function get() {
  if (!state.data) {
    const s = await SiteSetting.get();
    const ts = s.thmStats && typeof s.thmStats === 'object' ? s.thmStats : {};
    state.data = {
      ...DEFAULTS,
      ...Object.fromEntries(Object.entries(ts || {}).filter(([, v]) => v !== null && v !== undefined && v !== '')),
    };
  }
  // 1h+ purana → background me refresh (response stale values se turant jaata hai)
  if (Date.now() - state.lastAt > STALE_ON_DEMAND_MS && !state.syncing) {
    sync().catch(() => {});
  }
  return state.data;
}

function start() {
  if (state.started) return;
  state.started = true;
  setTimeout(() => sync().catch(() => {}), 5000); // boot par background sync
  const t = setInterval(() => sync().catch(() => {}), SYNC_EVERY_MS);
  t.unref();
  console.log('[THM] auto-sync loop started — every 6h + on-demand refresh');
}

// ---------- SVG card ----------
const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderCard(s) {
  const synced = s.syncedAt ? new Date(s.syncedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) + ' IST' : '—';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="110" viewBox="0 0 620 110" role="img" aria-label="TryHackMe stats card — ${esc(s.username)}">
  <rect x="1.5" y="1.5" width="617" height="107" rx="12" fill="#0d1117" stroke="#9acc14" stroke-width="1.5"/>
  <rect x="18" y="26" width="52" height="52" rx="10" fill="#0b1f12" stroke="#9acc14" stroke-width="1.5"/>
  <text x="44" y="63" font-family="Courier New, monospace" font-size="22" font-weight="bold" fill="#9acc14" text-anchor="middle">&gt;_</text>
  <text x="86" y="42" font-family="Courier New, monospace" font-size="17" font-weight="bold" fill="#ffffff" letter-spacing="1">TRYHACKME</text>
  <text x="86" y="64" font-family="Courier New, monospace" font-size="14" fill="#8b949e">@${esc(s.username)}</text>
  <text x="86" y="88" font-family="Courier New, monospace" font-size="13" font-weight="bold" fill="#c792ea">${esc(s.level)} · LIVE</text>
  <circle cx="248" cy="18" r="4" fill="#00ff41">
    <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite"/>
  </circle>
  <line x1="266" y1="16" x2="266" y2="94" stroke="#21262d" stroke-width="1"/>
  <text x="318" y="40" font-family="Courier New, monospace" font-size="11" fill="#8b949e" text-anchor="middle" letter-spacing="1">STREAK</text>
  <text x="318" y="70" font-family="Courier New, monospace" font-size="21" font-weight="bold" fill="#ff6633" text-anchor="middle">${Number(s.streak) || 0}d</text>
  <text x="400" y="40" font-family="Courier New, monospace" font-size="11" fill="#8b949e" text-anchor="middle" letter-spacing="1">ROOMS</text>
  <text x="400" y="70" font-family="Courier New, monospace" font-size="21" font-weight="bold" fill="#00e5ff" text-anchor="middle">${Number(s.rooms) || 0}</text>
  <text x="484" y="40" font-family="Courier New, monospace" font-size="11" fill="#8b949e" text-anchor="middle" letter-spacing="1">RANK</text>
  <text x="484" y="66" font-family="Courier New, monospace" font-size="19" font-weight="bold" fill="#9acc14" text-anchor="middle">${esc(s.rankPct)}</text>
  <text x="484" y="84" font-family="Courier New, monospace" font-size="11" fill="#8b949e" text-anchor="middle">#${Number(s.rankNum) || 0}</text>
  <text x="564" y="40" font-family="Courier New, monospace" font-size="11" fill="#8b949e" text-anchor="middle" letter-spacing="1">BADGES</text>
  <text x="564" y="70" font-family="Courier New, monospace" font-size="21" font-weight="bold" fill="#ffd60a" text-anchor="middle">${Number(s.badges) || 0}</text>
  <text x="604" y="102" font-family="Courier New, monospace" font-size="9" fill="#8b949e" text-anchor="end" opacity="0.7">sync: ${esc(synced)}</text>
</svg>`;
}

module.exports = { get, start, sync, renderCard, parseProfile };
