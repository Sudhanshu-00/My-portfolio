// ============ Hacker Portfolio JS ============
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

  // ---- Auto-fit grids: cards shrink/expand with item count ----
  // 3 items → 3 bade columns; 5+ items → 4 chhote columns, baaki niche rows me
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
