/**
 * GitHub live-data service (server-side, zero deps)
 * - Repo details: meta + languages + README + file tree
 * - Profile intel: repos, followers, stars, top languages
 * - 30-min in-memory cache → GitHub rate-limit (60/hr) se bacha rehta hai
 */
const TTL = 30 * 60 * 1000;
const cache = new Map();

const LANG_COLORS = {
  Python: '#3572A5', JavaScript: '#f1e05a', TypeScript: '#3178c6', HTML: '#e34c26',
  CSS: '#563d7c', EJS: '#a91e50', 'C#': '#178600', 'C++': '#f34b7d', C: '#555555',
  Java: '#b07219', Shell: '#89e051', 'Jupyter Notebook': '#DA5B0B', Vue: '#41b883',
  PHP: '#4F5D95', Ruby: '#701516', Go: '#00ADD8', Rust: '#dea584', Kotlin: '#A97BFF',
  Swift: '#F05138', Dockerfile: '#384d54', SCSS: '#c6538c', PowerShell: '#012456',
  Batchfile: '#C1F12E', Handlebars: '#f7931e', Mustache: '#724b3b', MDX: '#fcb32c',
};
const langColor = (n) => LANG_COLORS[n] || '#00ff41';

async function gh(path, opts = {}) {
  const res = await fetch('https://api.github.com' + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'portfolio-app',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const e = new Error(`GitHub ${res.status}`);
    e.status = res.status;
    throw e;
  }
  // raw text responses (e.g. README raw) ko JSON parse karne ki koshish mat karo
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  try {
    const v = await fn();
    cache.set(key, { v, t: Date.now() });
    return v;
  } catch (e) {
    if (hit) return hit.v; // stale copy better than nothing
    return { ok: false, reason: e.status === 403 || e.status === 429 ? 'rate-limited' : 'unavailable' };
  }
}

const fmtSize = (kb) => (kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB');

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

/** repoUrl → { ok, meta, languages, readme, files } */
async function getRepoDetails(repoUrl) {
  const m = String(repoUrl || '').match(/github\.com\/([\w.-]+)\/([\w.-]+)/i);
  if (!m) return { ok: false, reason: 'no-github-url' };
  const [, owner, repoRaw] = m;
  const repo = repoRaw.replace(/\.git$/, '');
  return cached(`repo:${owner}/${repo}`, async () => {
    const [meta, langs, readme, contents] = await Promise.all([
      gh(`/repos/${owner}/${repo}`),
      gh(`/repos/${owner}/${repo}/languages`).catch(() => ({})),
      gh(`/repos/${owner}/${repo}/readme`, { headers: { Accept: 'application/vnd.github.raw+json' } })
        .then((r) => (typeof r === 'string' ? r : ''))
        .catch(() => ''),  // raw text milega → gh() ab text return karta hai
      gh(`/repos/${owner}/${repo}/contents`).catch(() => []),
    ]);
    const langTotal = Object.values(langs).reduce((a, b) => a + b, 0) || 1;
    return {
      ok: true,
      meta: {
        owner,
        repo,
        fullName: meta.full_name,
        description: meta.description || '',
        stars: meta.stargazers_count,
        forks: meta.forks_count,
        watchers: meta.watchers_count,
        issues: meta.open_issues_count,
        size: fmtSize(meta.size),
        primaryLanguage: meta.language,
        languageColor: langColor(meta.language),
        topics: meta.topics || [],
        defaultBranch: meta.default_branch || 'main',
        createdAt: fmtDate(meta.created_at),
        pushedAt: fmtDate(meta.pushed_at),
        url: meta.html_url,
      },
      languages: Object.entries(langs)
        .map(([name, bytes]) => ({ name, pct: Math.round((bytes / langTotal) * 100), color: langColor(name) }))
        .sort((a, b) => b.pct - a.pct),
      readme,
      files: (Array.isArray(contents) ? contents : []).map((f) => ({
        name: f.name,
        type: f.type === 'dir' ? 'dir' : 'file',
        size: f.type === 'file' ? fmtSize(Math.round(f.size / 1024)) : '',
      })),
    };
  });
}

/** username → { ok, profile, totalStars, topLanguages } */
async function getProfile(username) {
  return cached(`profile:${username}`, async () => {
    const [p, repos] = await Promise.all([
      gh(`/users/${username}`),
      gh(`/users/${username}/repos?per_page=100&sort=updated`).catch(() => []),
    ]);
    const totalStars = repos.reduce((a, r) => a + (r.stargazers_count || 0), 0);
    const langCount = {};
    repos.forEach((r) => {
      if (r.language) langCount[r.language] = (langCount[r.language] || 0) + 1;
    });
    const topLanguages = Object.entries(langCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count, color: langColor(name) }));
    return {
      ok: true,
      profile: {
        username: p.login,
        name: p.name || p.login,
        bio: p.bio || '',
        avatar: p.avatar_url,
        followers: p.followers,
        following: p.following,
        publicRepos: p.public_repos,
        createdAt: fmtDate(p.created_at),
        url: p.html_url,
      },
      totalStars,
      topLanguages,
      repoCount: repos.length,
    };
  });
}

/** Minimal markdown → HTML (safe: HTML pehle escape hota hai) */
function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = esc(md || '');

  // fenced code blocks
  html = html.replace(/```[a-z]*\n([\s\S]*?)```/g, (_, code) => `<pre class="md-code">${code.trim()}</pre>`);

  const lines = html.split('\n');
  const out = [];
  let inList = false;
  for (let line of lines) {
    const l = line.trim();
    if (l.startsWith('<pre')) { if (inList) { out.push('</ul>'); inList = false; } out.push(line); continue; }
    if (/^\|.*\|$/.test(l)) { // table row → mono line
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<div class="md-row">${l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter((c, i, a) => !(c.match(/^:?-+:?$/) && a.length > 2)).join(' &nbsp;·&nbsp; ')}</div>`);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(l)) { if (inList) { out.push('</ul>'); inList = false; } out.push('<hr class="md-hr">'); continue; }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) { if (inList) { out.push('</ul>'); inList = false; } out.push(`<h3 class="md-h md-h${h[1].length}">${h[2]}</h3>`); continue; }
    const li = l.match(/^[-*+]\s+(.*)/);
    if (li) { if (!inList) { out.push('<ul class="md-ul">'); inList = true; } out.push(`<li>${li[1]}</li>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (!l) { out.push(''); continue; }
    out.push(`<p class="md-p">${line}</p>`);
  }
  if (inList) out.push('</ul>');
  html = out.join('\n');

  // inline: bold, italic, code, links, images→alt
  html = html
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<span class="md-img">🖼 $1</span>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
  return html;
}

module.exports = { getRepoDetails, getProfile, mdToHtml, langColor };
