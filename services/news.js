/**
 * Live Threat Feed — automated hacker-news aggregator ("blog" page).
 *
 *  Multiple free security sources (RSS + JSON, no API keys) se latest
 *  exploits / CVEs / breach news fetch karta hai, DB me dedupe karke
 *  store karta hai, aur purani entries auto-delete hoti hain.
 *
 *  Sources:
 *   - The Hacker News        (RSS)  — latest cyber attacks / malware
 *   - BleepingComputer       (RSS)  — breaches, ransomware, patches
 *   - KrebsOnSecurity        (RSS)  — deep-dive investigative stories
 *   - Dark Reading           (RSS)  — enterprise security news
 *   - Zero Day Initiative    (RSS)  — 0-day advisories, Pwn2Own
 *   - CISA KEV               (JSON) — actively-exploited CVE catalog
 *   - NVD recent CVEs        (JSON) — newly published CVEs + CVSS severity
 *
 *  Loop:
 *   - boot par turant fetch (background), phir har REFRESH_EVERY (30 min)
 *   - dedupe: sha1(source|link) — same article dobara store nahi hota
 *   - purge: 10 din purane items TTL-index se auto-delete + har refresh par
 *     hard cap 400 (sabse purane sabse pehle udate hain)
 *
 *  Admin panel → Threat Feed: stats + per-source health + manual refresh.
 *  Status in-process hai (state object) — restart par fresh counters.
 */
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { NewsItem } = require('../models');

const REFRESH_EVERY = 30 * 60 * 1000; // 30 min auto-refresh
const MAX_AGE_DAYS = 10;              // "purana wala hate" — 10 din baad auto-delete
const MAX_ITEMS = 400;                // hard cap — DB bounded rehta hai
const FETCH_TIMEOUT = 12_000;         // per-source timeout
const MANUAL_COOLDOWN = 60_000;       // manual refresh spam-guard

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---------- source registry ----------
const SOURCES = [
  {
    key: 'thehackernews',
    label: 'The Hacker News',
    kind: 'news',
    url: 'https://feeds.feedburner.com/TheHackersNews',
    type: 'rss',
  },
  {
    key: 'bleepingcomputer',
    label: 'BleepingComputer',
    kind: 'news',
    url: 'https://www.bleepingcomputer.com/feed/',
    type: 'rss',
  },
  {
    key: 'krebsonsecurity',
    label: 'KrebsOnSecurity',
    kind: 'news',
    url: 'https://krebsonsecurity.com/feed/',
    type: 'rss',
  },
  {
    key: 'darkreading',
    label: 'Dark Reading',
    kind: 'news',
    url: 'https://www.darkreading.com/rss.xml',
    type: 'rss',
  },
  {
    key: 'zdi',
    label: 'Zero Day Initiative',
    kind: 'exploit',
    url: 'https://www.zerodayinitiative.com/blog?format=rss',
    type: 'rss',
  },
  {
    key: 'cisakev',
    label: 'CISA KEV',
    kind: 'exploit',
    url: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
    type: 'json',
  },
  {
    key: 'nvd',
    label: 'NVD (New CVEs)',
    kind: 'cve',
    // NOTE: fetchNvd() har refresh par pubStartDate fresh inject karta hai (last 48h) —
    // bina date ke NVD 1988 ke sabse-purane CVEs deta hai, newest nahi.
    url: 'https://services.nvd.nist.gov/rest/json/cves/2.0?resultsPerPage=40',
    type: 'json',
  },
];

const state = {
  started: false,
  fetching: false,
  lastRefreshAt: null,
  nextRefreshAt: null,
  lastError: '',
  perSource: {}, // key → { ok, count, error, at }
  manualLastAt: 0,
};

// ---------- low-level fetch (gzip/deflate/br + redirects, no deps) ----------
function fetchUrl(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      timeout: FETCH_TIMEOUT,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/rss+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
      },
    }, (res) => {
      // follow redirects (feedburner & co.)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(new URL(res.headers.location, url).href, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > 8 * 1024 * 1024) { req.destroy(); reject(new Error('response too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => {
        try {
          let buf = Buffer.concat(chunks);
          const enc = String(res.headers['content-encoding'] || '').toLowerCase();
          if (enc.includes('br')) buf = zlib.brotliDecompressSync(buf);
          else if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
          resolve(buf.toString('utf8'));
        } catch (e) {
          reject(new Error('decompress failed: ' + e.message));
        }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// ---------- text helpers ----------
const decodeEntities = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ''; } })
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return ''; } })
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e] || e));

const stripHtml = (s) => decodeEntities(String(s || ''))
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const betweenTags = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
};

// ---------- RSS / Atom parser (regex-based, koi dep nahi) ----------
function parseRss(xml, source) {
  const items = [];
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) || [];
  for (const raw of blocks.slice(0, 30)) {
    let title = stripHtml(betweenTags(raw, 'title'));
    // RSS <link>text</link> — Atom <link href="...">
    let link = '';
    const atomLink = raw.match(/<link\s[^>]*href=["']([^"']+)["']/i);
    if (atomLink) link = atomLink[1];
    else link = stripHtml(betweenTags(raw, 'link'));
    // feedburner origLink (The Hacker News) — original article ka direct link
    const orig = raw.match(/<feedburner:origLink>([\s\S]*?)<\/feedburner:origLink>/i);
    if (orig) link = stripHtml(orig[1]);
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const summary = stripHtml(
      betweenTags(raw, 'description') || betweenTags(raw, 'summary') || betweenTags(raw, 'content')
    ).slice(0, 400);
    const dateStr = betweenTags(raw, 'pubDate') || betweenTags(raw, 'published') || betweenTags(raw, 'updated');
    const publishedAt = dateStr && !isNaN(new Date(dateStr)) ? new Date(dateStr) : new Date();
    // 20 din se purane items skip (feed me kabhi kabhi purane bhi ghus jate hain)
    if (Date.now() - publishedAt.getTime() > 20 * 24 * 60 * 60 * 1000) continue;
    items.push({ title: title.slice(0, 250), link, summary, publishedAt });
  }
  return items.map((i) => decorate(i, source));
}

// keyword-based classification — title/summary se exploit/0-day tags nikalti hain
const EXPLOIT_RE = /\b(0[- ]?day|zero[- ]?day|exploit|poc|proof[- ]of[- ]concept|rce|remote code execution|weaponi[sz]ed|in the wild)\b/i;
const MALWARE_RE = /\b(ransomware|malware|backdoor|stealer|botnet|trojan|infostealer|rootkit)\b/i;

function decorate(item, source) {
  const hay = `${item.title} ${item.summary}`;
  const tags = [];
  if (EXPLOIT_RE.test(hay)) tags.push('exploit');
  if (MALWARE_RE.test(hay)) tags.push('malware');
  let kind = source.kind;
  let severity = '';
  if (source.key === 'cisakev') { kind = 'exploit'; severity = 'critical'; } // KEV = actively exploited
  else if (kind === 'exploit' || (kind === 'news' && tags.includes('exploit'))) { severity = 'high'; }
  return { ...item, kind, severity, tags };
}

// ---------- per-source fetchers ----------
async function fetchRssSource(s) {
  const xml = await fetchUrl(s.url);
  return parseRss(xml, s);
}

async function fetchCisaKev(s) {
  const data = JSON.parse(await fetchUrl(s.url));
  const list = (data && data.vulnerabilities) || [];
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return list
    .map((v) => ({
      title: `${v.cveID} — ${v.vulnerabilityName || 'Known Exploited Vulnerability'}`.slice(0, 250),
      link: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
      summary: `${v.vendorProject || ''} ${v.product || ''}: ${stripHtml(v.shortDescription || '')}`.slice(0, 400),
      publishedAt: v.dateAdded ? new Date(v.dateAdded) : new Date(),
      kind: 'exploit',
      severity: 'critical',
      tags: ['kev', 'in-the-wild'],
    }))
    .filter((i) => i.publishedAt.getTime() >= cutoff)
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 40);
}

const cvssSeverity = (score) => (score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low');

async function fetchNvd(s) {
  // NVD 2.0 API: pubStartDate + pubEndDate DONO required (akele start → 404).
  // Window = last 48h (120-day max rule ke andar). Fresh dates har call par.
  const start = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
  const end = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
  const data = JSON.parse(await fetchUrl(
    s.url + '&pubStartDate=' + encodeURIComponent(start) + '&pubEndDate=' + encodeURIComponent(end)
  ));
  const vulns = (data && data.vulnerabilities) || [];
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000; // sirf last 3 din ke CVEs
  const out = [];
  for (const { cve } of vulns) {
    if (!cve || !cve.id) continue;
    const publishedAt = cve.published ? new Date(cve.published) : new Date();
    if (publishedAt.getTime() < cutoff) continue;
    const desc = ((cve.descriptions || []).find((d) => d.lang === 'en') || {}).value || '';
    const metric = cve.metrics && (cve.metrics.cvssMetricV31 || cve.metrics.cvssMetricV30 || cve.metrics.cvssMetricV2 || [])[0];
    const score = metric && metric.cvssData ? metric.cvssData.baseScore : null;
    out.push({
      title: `${cve.id} — ${(stripHtml(desc).slice(0, 120) || 'Newly published CVE')}${desc.length > 120 ? '…' : ''}`.slice(0, 250),
      link: `https://nvd.nist.gov/vuln/detail/${cve.id}`,
      summary: stripHtml(desc).slice(0, 400),
      publishedAt,
      kind: 'cve',
      severity: score != null ? cvssSeverity(score) : 'medium',
      tags: score != null ? [`cvss ${score}`] : [],
    });
    if (out.length >= 40) break;
  }
  return out;
}

// ---------- refresh cycle ----------
async function refresh(manual = false) {
  if (state.fetching) return { ok: false, reason: 'already-running' };
  if (manual && Date.now() - state.manualLastAt < MANUAL_COOLDOWN) {
    return { ok: false, reason: 'cooldown' };
  }
  state.fetching = true;
  if (manual) state.manualLastAt = Date.now();

  let added = 0, scanned = 0;
  const errors = [];

  await Promise.all(SOURCES.map(async (s) => {
    try {
      const items = s.type === 'json' && s.key === 'cisakev' ? await fetchCisaKev(s)
        : s.type === 'json' ? await fetchNvd(s)
        : await fetchRssSource(s);
      scanned += items.length;
      // dedupe + insert (ek bhi duplicate skip hoga — extId unique index)
      for (const it of items.slice(0, 30)) {
        const extId = crypto.createHash('sha1').update(s.key + '|' + it.link).digest('hex');
        const r = await NewsItem.updateOne(
          { extId },
          {
            $setOnInsert: {
              extId,
              source: s.key,
              sourceLabel: s.label,
              title: it.title,
              link: it.link,
              summary: it.summary || '',
              kind: it.kind || s.kind || 'news',
              severity: it.severity || '',
              tags: (it.tags || []).slice(0, 5),
              publishedAt: it.publishedAt || new Date(),
            },
          },
          { upsert: true }
        );
        if (r.upsertedCount) added++;
      }
      state.perSource[s.key] = { ok: true, count: items.length, error: '', at: new Date() };
    } catch (e) {
      errors.push(`${s.label}: ${e.message}`);
      state.perSource[s.key] = { ok: false, count: 0, error: e.message, at: new Date() };
    }
  }));

  // purge: TTL index bhi hai, par cap 400 ko enforce karna hamara kaam hai
  try {
    await NewsItem.deleteMany({ createdAt: { $lt: new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000) } });
    const total = await NewsItem.countDocuments();
    if (total > MAX_ITEMS) {
      const oldest = await NewsItem.find().sort({ publishedAt: 1 }).skip(total - (total - MAX_ITEMS) - 1).limit(total - MAX_ITEMS).select('_id').lean();
      const ids = oldest.map((d) => d._id);
      if (ids.length) await NewsItem.deleteMany({ _id: { $in: ids } });
    }
  } catch { /* prune fail → next cycle try karega */ }

  state.fetching = false;
  state.lastRefreshAt = new Date();
  state.nextRefreshAt = new Date(Date.now() + REFRESH_EVERY);
  state.lastError = errors.join(' | ');
  console.log(`[NEWS] refresh ${manual ? '(manual)' : '(auto)'} — scanned ${scanned}, added ${added}${errors.length ? `, errors: ${errors.length}` : ''}`);
  return { ok: true, added, scanned, errors };
}

function start() {
  if (state.started) return;
  state.started = true;
  // boot par turant (background — page-load block nahi hota)
  setTimeout(() => refresh().catch(() => {}), 1500);
  const t = setInterval(() => refresh().catch(() => {}), REFRESH_EVERY);
  t.unref();
  console.log(`[NEWS] threat feed loop started — auto-refresh every ${REFRESH_EVERY / 60000} min, TTL ${MAX_AGE_DAYS} days`);
}

function status() {
  return { ...state, sources: SOURCES.map(({ key, label, kind }) => ({ key, label, kind })) };
}

module.exports = { start, refresh, status, REFRESH_EVERY, MAX_AGE_DAYS };
