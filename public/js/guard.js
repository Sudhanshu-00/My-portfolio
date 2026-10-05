/* ============ Anti-Inspect Guard (deterrent layer) ============
   Note: this is a client-side deterrent — stops casual users/inspectors.
   Determined attackers (curl, extensions) can only be stopped by server-side security. */
(function () {
  'use strict';

  // ---- console warning + clear ----
  try { console.clear(); } catch (e) {}
  var style = 'color:#ff2d55;font-size:22px;font-weight:900;text-shadow:0 0 8px rgba(255,45,85,.5)';
  console.log('%c⚠ STOP — ACCESS RESTRICTED', style);
  console.log('%cThis area is monitored for unauthorized inspection. If you are the developer, use the admin panel.', 'color:#00ff41;font-size:12px');

  // ---- right-click block ----
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    return false;
  }, { capture: true });

  // ---- shortcut block: F12, Ctrl+Shift+I/J/C/K, Ctrl+U, Ctrl+S ----
  function blocked(e) {
    var k = (e.key || '').toLowerCase();
    if (e.key === 'F12') return true;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c', 'k'].indexOf(k) > -1) return true;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (k === 'u' || k === 's')) return true;
    return false;
  }
  document.addEventListener('keydown', function (e) {
    if (blocked(e)) {
      e.preventDefault();
      e.stopPropagation();
      devtoolsFlash();
      return false;
    }
  }, { capture: true });

  // ---- devtools open detection (window-size heuristic) ----
  var overlay = null;
  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = '__guard_overlay';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:#050505f2;color:#ff2d55;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'font-family:monospace;text-align:center;backdrop-filter:blur(6px)';
    overlay.innerHTML =
      '<div style="font-size:64px">🚫</div>' +
      '<h1 style="font-size:26px;margin:.5em 0;letter-spacing:2px">DEVELOPER TOOLS DETECTED</h1>' +
      '<p style="color:#888;max-width:420px;line-height:1.6">Content on this website is protected.<br>Close DevTools — the page will restore itself automatically.</p>';
    document.documentElement.appendChild(overlay);
  }
  function devtoolsFlash() {
    if (!overlay && isOpen()) show();
  }
  function isOpen() {
    var w = window.outerWidth - window.innerWidth > 160;
    var h = window.outerHeight - window.innerHeight > 160;
    return w || h;
  }
  function show() { if (!overlay) buildOverlay(); }
  function hide() { if (overlay) { overlay.remove(); overlay = null; } }

  // ---- touch devices (mobile/tablet) par size-heuristic band ----
  // Mobile browsers (Brave/Safari/Chrome Android) outer/inner size me bada
  // difference report karte hain (browser toolbar/UI/shields ki wajah se)
  // → false "DEVELOPER TOOLS DETECTED" overlay. Real desktop devtools hi
  // is heuristic ka target hai — touch device par check skip, overlay hamesha hide.
  var isTouch = false;
  try {
    isTouch = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
              ('ontouchstart' in window) ||
              (navigator.maxTouchPoints || 0) > 0;
  } catch (e) {}

  setInterval(function () {
    if (isTouch) { hide(); return; }
    isOpen() ? show() : hide();
  }, 1200);
})();
