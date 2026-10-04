/**
 * Signup wizard — CSP-safe (script-src 'self', koi inline JS nahi).
 * 1. Step 2: resend button 45s countdown (server bhi enforce karta hai)
 * 2. Step 3: captcha image click → fresh captcha (cache-bust)
 */
(function () {
  'use strict';

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
