/**
 * Signup wizard — CSP-safe (script-src 'self', no inline JS).
 * 1. Step 2: resend button 45s countdown (server bhi enforce karta hai)
 * 2. Step 3: captcha image click → fresh captcha (cache-bust)
 */
(function () {
  'use strict';

  // ---- double-submit guard (har form.form pe) ----
  // Slow SMTP pe page hang lagta hai → user tap-tap karta hai → 5 OTPs issue ho
  // jate the. Ek click = ek request. Page reload (error/success) pe auto-reset.
  document.querySelectorAll('form.form').forEach(function (f) {
    f.addEventListener('submit', function () {
      var b = f.querySelector('button[type="submit"]');
      if (b) { b.disabled = true; b.textContent = 'Please wait…'; }
    });
  });

  // ---- resend countdown ----
  var btn = document.getElementById('resendBtn');
  if (btn) {
    var left = 45;
    btn.disabled = true;
    var t = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(t);
        btn.disabled = false;
        btn.textContent = 'Resend OTP';
      } else {
        btn.textContent = 'Resend OTP (' + left + 's)';
      }
    }, 1000);
  }

  // ---- captcha refresh ----
  var img = document.getElementById('captchaImg');
  if (img) {
    img.addEventListener('click', function () {
      this.src = '/signup/captcha.svg?t=' + Date.now();
    });
  }
})();
