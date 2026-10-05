// services/ghsync.js — GitHub repos → portfolio Projects auto-sync
//
// Github par naya public repo banate hi portfolio ke /projects me aa jata hai —
// manually add karne ki zaroorat nahi.
//
// Flow:
//   - boot +8s: background sync (page-load block nahi hota)
//   - har 6h auto-sync (GitHub API se public repos list → upsert)
//   - /projects page load par agar data 1h+ purana → background re-sync
//   - admin ne kisi project ko edit kiya to usko sync kabhi overwrite nahi karta
//   - forks + profile README repo skip
//   - repo delete/rename/private ho jaye → portfolio entry safe rehti hai (kuch delete nahi hota)

const { Project, SiteSetting } = require('../models');
const { gh } = require('./github');

const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;   // 6h — routine refresh
const STALE_ON_DEMAND_MS = 60 * 60 * 1000;  // 1h — page-load par bhi refresh try
const MAX_REPOS = 100;

const state = { started: false, syncing: false, lastAt: 0, lastError: '', lastRun: null };

// ye repos portfolio project nahi hain
const SKIP_REPOS = new Set(['Sudhanshu-00/Sudhanshu-00']); // profile README repo

// ---------- sync ----------
async function sync(manual = false) {
  if (state.syncing) return { ok: false, reason: 'already-running' };
  state.syncing = true;
  try {
    const username = (await SiteSetting.get()).githubUsername || 'Sudhanshu-00';
    const skipList = new Set((await SiteSetting.get()).ghSyncSkip || []); // admin-deleted auto projects

    // public repos — ek hi API call (60/hr anonymous limit, 6h me ~4 calls — safe)
    // GitHub kabhi-kabhi transient empty list deta hai → 15s baad ek retry
    let repos = await gh(`/users/${username}/repos?per_page=${MAX_REPOS}&sort=pushed`);
    if (Array.isArray(repos) && repos.length === 0) {
      await new Promise((r) => setTimeout(r, 15000));
      repos = await gh(`/users/${username}/repos?per_page=${MAX_REPOS}&sort=pushed`);
    }
    if (!Array.isArray(repos)) throw new Error('unexpected GitHub response');
    if (repos.length === 0) throw new Error('GitHub returned 0 repos — transient glitch, next cycle retry');

    let added = 0, updated = 0, skipped = 0;

    for (const r of repos) {
      if (r.fork) { skipped++; continue; }                       // forks = original ka copy, skip
      if (SKIP_REPOS.has(r.full_name)) { skipped++; continue; }  // profile repo
      if (skipList.has(r.html_url)) { skipped++; continue; }     // admin ne delete kiya tha — tombstone

      const githubUrl = r.html_url;
      const tech = [r.language, ...(r.topics || [])]
        .filter(Boolean)
        .slice(0, 8)
        .join(', ')
        .slice(0, 300);
      const desc = (r.description || '').slice(0, 5000) || 'Auto-synced from GitHub — description coming soon.';
      const live = /^https?:\/\//i.test(r.homepage || '') ? r.homepage : '';
      const ghMeta = {
        description: desc,
        techStack: tech,
        liveUrl: live,
        ghSyncedAt: new Date(),
      };

      let p = await Project.findOne({ githubUrl });
      if (!p) {
        await Project.create({
          title: r.name.slice(0, 120),
          description: desc,
          techStack: tech,
          liveUrl: live,
          githubUrl,
          featured: false, // naye repos non-featured — admin chahe to Admin panel se featured kar de
          source: 'github',
          ghSyncedAt: new Date(),
        });
        added++;
        console.log(`[GHSYNC] + ${r.name}`);
        continue;
      }

      // manually created (admin/seed) — ghSyncedAt null → kabhi overwrite nahi,
      // sirf bilkul KHAALI fields backfill karte hain (admin ka content safe)
      if (!p.ghSyncedAt) {
        let touched = false;
        if (!p.description) { p.description = desc; touched = true; }
        if (!p.techStack) { p.techStack = tech; touched = true; }
        if (!p.liveUrl && live) { p.liveUrl = live; touched = true; }
        if (touched) await p.save();
        skipped++;
        continue;
      }

      // admin ne last sync ke baad edit kiya? → uski edits respect, overwrite nahi
      if (p.updatedAt > p.ghSyncedAt) { skipped++; continue; }

      // sync-managed fields refresh (title/image/featured admin ke paas rehte hain)
      const before = JSON.stringify([p.description, p.techStack, p.liveUrl]);
      Object.assign(p, ghMeta);
      if (JSON.stringify([p.description, p.techStack, p.liveUrl]) !== before) {
        await p.save();
        updated++;
      } else {
        p.ghSyncedAt = ghMeta.ghSyncedAt;
        await Project.updateOne({ _id: p._id }, { $set: { ghSyncedAt: ghMeta.ghSyncedAt } });
      }
    }

    state.lastAt = Date.now();
    state.lastError = '';
    state.lastRun = { added, updated, skipped, total: repos.length, at: state.lastAt };
    console.log(`[GHSYNC] done — +${added} new, ~${updated} updated, ${skipped} skipped (of ${repos.length} repos)`);
    return { ok: true, ...state.lastRun };
  } catch (e) {
    state.lastError = String((e && e.message) || e).slice(0, 80);
    state.lastAt = Date.now();
    console.warn('[GHSYNC] fail:', state.lastError, '— existing projects waise hi chalte rahenge');
    return { ok: false, error: state.lastError };
  } finally {
    state.syncing = false;
  }
}

// ---------- public ----------
// /projects route ise call karta hai — 1h+ purana ho to background refresh
function refreshIfStale() {
  if (Date.now() - state.lastAt > STALE_ON_DEMAND_MS && !state.syncing) {
    sync().catch(() => {});
  }
  return { lastRun: state.lastRun, lastError: state.lastError, syncing: state.syncing };
}

function start() {
  if (state.started) return;
  state.started = true;
  setTimeout(() => sync().catch(() => {}), 8000); // boot par background sync
  const t = setInterval(() => sync().catch(() => {}), SYNC_EVERY_MS);
  t.unref();
  console.log('[GHSYNC] auto-sync loop started — every 6h + on-demand refresh');
}

module.exports = { sync, start, refreshIfStale };
