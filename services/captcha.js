// captcha SVG — per-char rotation + noise lines/dots, confusing chars removed.
// Shared by admin routes (login + signup) and user routes (gated admin login).
// Output is a plain <svg> string — served as image/svg+xml, never interpolated
// into HTML, so it cannot smuggle markup.
module.exports = function captchaSvg(text) {
  const W = 190, H = 62;
  const palette = ['#7ee787', '#79c0ff', '#ffa657', '#d2a8ff', '#ff7b72'];
  const glyphs = [...text].map((ch, i) => {
    const x = 25 + i * 31 + (Math.random() * 8 - 4);
    const y = 40 + (Math.random() * 10 - 5);
    const rot = Math.random() * 50 - 25;
    const fill = palette[Math.floor(Math.random() * palette.length)];
    const fs = 27 + Math.random() * 8;
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${fill}" font-size="${fs.toFixed(1)}" font-family="monospace" font-weight="bold">${ch}</text>`;
  }).join('');
  const lines = Array.from({ length: 4 }, () => `<line x1="${(Math.random() * W).toFixed(0)}" y1="${(Math.random() * H).toFixed(0)}" x2="${(Math.random() * W).toFixed(0)}" y2="${(Math.random() * H).toFixed(0)}" stroke="${palette[Math.floor(Math.random() * palette.length)]}" stroke-width="1" opacity="0.5"/>`).join('');
  const dots = Array.from({ length: 40 }, () => `<circle cx="${(Math.random() * W).toFixed(0)}" cy="${(Math.random() * H).toFixed(0)}" r="1" fill="${palette[Math.floor(Math.random() * palette.length)]}" opacity="0.6"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#0d1117" rx="8"/>${lines}${dots}${glyphs}</svg>`;
};

// 5 random chars from a confusion-safe alphabet (no 0/o, 1/i/l)
module.exports.newText = function captchaText(len = 5) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};
