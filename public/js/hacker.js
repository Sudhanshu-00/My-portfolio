// ============ Hacker Portfolio JS ============
// ---- Mobile navbar (hamburger): click se 3-line menu khulta/band hota hai ----
document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.nav');
  const toggle = document.getElementById('navToggle');
  if (!nav || !toggle) return;
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // koi link/button click → menu band (navigate ke baad khula na rahe)
  nav.querySelectorAll('.nav-links a, .nav-links button').forEach((el) =>
    el.addEventListener('click', () => nav.classList.remove('open'))
  );
  // navbar ke bahar click → band
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('open') && !nav.contains(e.target)) {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  // Escape key → band
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('open')) {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  // desktop size par resize → khula hamburger menu band kar do
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900 && nav.classList.contains('open')) {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  // back/forward navigation se wapas aane par menu closed state me rahe
  window.addEventListener('pageshow', () => {
    nav.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  });
});
document.addEventListener('DOMContentLoaded', () => {
  // ---- Boot loader (only first visit per session) ----
  const boot = document.getElementById('boot');
  const bootText = document.getElementById('boot-text');
  if (boot && bootText) {
    if (sessionStorage.getItem('booted')) {
      boot.remove();
    } else {
      const lines = [
        '[ OK ] Initializing secure shell v2.0...',
        '[ OK ] Loading modules: recon, exploit, post-exploit',
        '[ OK ] Establishing encrypted uplink... 100%',
        '[ OK ] Injecting portfolio payload',
        '[ >>> ] ACCESS GRANTED',
      ];
      let i = 0;
      const t = setInterval(() => {
        if (i < lines.length) {
          bootText.textContent += lines[i++] + '\n';
        } else {
          clearInterval(t);
          setTimeout(() => {
            boot.classList.add('gone');
            sessionStorage.setItem('booted', '1');
            setTimeout(() => boot.remove(), 600);
          }, 400);
        }
      }, 170);
    }
  }

  // ---- Typing effect (hero) ----
  const typed = document.getElementById('typed');
  if (typed) {
    const roles = [
      'Penetration Tester',
      'Security Researcher',
      'Android & Web Pentester',
      'Security Tool Developer',
      'Bug Bounty Hunter',
    ];
    let ri = 0, ci = 0, del = false;
    (function tick() {
      const word = roles[ri];
      typed.textContent = word.slice(0, ci);
      if (!del && ci < word.length) { ci++; setTimeout(tick, 70); }
      else if (!del && ci === word.length) { del = true; setTimeout(tick, 1500); }
      else if (del && ci > 0) { ci--; setTimeout(tick, 35); }
      else { del = false; ri = (ri + 1) % roles.length; setTimeout(tick, 350); }
    })();
  }

  // ---- Matrix rain (hero background) ----
  const cv = document.getElementById('matrix');
  if (cv) {
    const ctx = cv.getContext('2d');
    const chars = 'アカサタナハマヤラワン01{}</>$#*+=;:终端';
    let drops = [];
    function size() {
      cv.width = cv.offsetWidth;
      cv.height = cv.offsetHeight;
      drops = Array(Math.floor(cv.width / 14)).fill(1);
    }
    size();
    window.addEventListener('resize', size);
    setInterval(() => {
      ctx.fillStyle = 'rgba(3, 8, 5, 0.09)';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#00ff41';
      ctx.font = '13px monospace';
      drops.forEach((y, i) => {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(ch, i * 14, y * 14);
        if (y * 14 > cv.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      });
    }, 50);
  }

  // ---- Colored tech chips (GitHub language colors) ----
  const TECH_COLORS = {
    python: '#3572A5', javascript: '#f1e05a', typescript: '#3178c6', html: '#e34c26',
    css: '#563d7c', ejs: '#a91e50', react: '#61dafb', node: '#3c873a', 'node.js': '#3c873a',
    express: '#444', mongodb: '#4db33d', mysql: '#00758f', sql: '#e38c00', 'sql server': '#a91e11',
    'c#': '#178600', '.net': '#512bd4', microservices: '#7c3aed', api: '#00b8d9', rest: '#00b8d9',
    cisco: '#1ba0d7', networking: '#1ba0d7', ccna: '#1ba0d7', linux: '#fcc624', bash: '#4eaa25',
    burp: '#ff6633', nmap: '#4682b4', osint: '#00c853', recon: '#00e5ff', payloads: '#ff2d55',
    'blue team': '#2196f3', 'red team': '#ff1744', pentesting: '#00ff41', security: '#00ff41',
    docker: '#2496ed', git: '#f05032', bootstrap: '#7952b3', tailwind: '#38bdf8',
  };
  const hashColor = (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    const hues = [0, 120, 210, 280, 45, 160];
    return `hsl(${hues[h % hues.length]}, 70%, 55%)`;
  };
  document.querySelectorAll('.chip').forEach((c) => {
    const key = c.textContent.trim().toLowerCase();
    const color = TECH_COLORS[key] || hashColor(key);
    c.style.borderColor = color;
    c.style.color = color;
    c.style.boxShadow = `0 0 8px ${color}33`;
  });

  // ---- Auto-fit grids: cards shrink/expand with item count ----
  // 3 items → 3 large columns; 5+ items → 4 smaller columns, rest wraps to rows below
  function autoGrids() {
    const w = window.innerWidth;
    const maxByWidth = w < 640 ? 1 : w < 1000 ? 2 : 4;
    document.querySelectorAll('[data-autogrid]').forEach((g) => {
      const cap = parseInt(g.dataset.autogrid, 10) || 4;
      const n = Math.min(g.children.length, cap, maxByWidth) || 1;
      g.style.setProperty('--cols', n);
    });
  }
  autoGrids();
  window.addEventListener('resize', autoGrids);

  // ---- Tool category filter ----
  const filters = document.getElementById('filters');
  if (filters) {
    filters.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      filters.querySelectorAll('button').forEach((x) => {
        x.classList.remove('active');
        x.classList.add('ghost');
      });
      b.classList.add('active');
      b.classList.remove('ghost');
      const f = b.dataset.filter;
      document.querySelectorAll('#tools-grid .card').forEach((c) => {
        c.style.display = f === 'all' || c.dataset.cat === f ? '' : 'none';
      });
    });
  }
});
