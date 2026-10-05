// Show/hide password toggles + captcha refresh — zero inline JS (CSP-safe).
// Usage: <button type="button" data-reveal="id-of-input">👁 show</button>
//        <img data-refresh src="/login/captcha.svg"> → click = new captcha
(function () {
  document.addEventListener('click', function (e) {
    // captcha refresh — any image with [data-refresh]
    var img = e.target.closest('img[data-refresh]');
    if (img) {
      img.src = img.src.split('?')[0] + '?t=' + Date.now();
      return;
    }
    // password reveal toggle
    var btn = e.target.closest('[data-reveal]');
    if (!btn) return;
    var input = document.getElementById(btn.getAttribute('data-reveal'));
    if (!input) return;
    var show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? '🙈 hide' : '👁 show';
    btn.setAttribute('aria-pressed', show ? 'true' : 'false');
  });
})();
