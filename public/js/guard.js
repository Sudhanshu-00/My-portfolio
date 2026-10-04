/* ============ Anti-Inspect Guard (deterrent layer) ============
   Note: ye client-side deterrent hai — casual users/inspectors roko.
   Determined attacker (curl, extensions) ko server-side security hi rok sakti hai. */
(function () {
  'use strict';

  // ---- console warning + clear ----
  try { console.clear(); } catch (e) {}
  var style = 'color:#ff2d55;font-size:22px;font-weight:900;text-shadow:0 0 8px rgba(255,45,85,.5)';
  console.log('%c⚠ STOP — ACCESS RESTRICTED', style);
  console.log('%cYe area unauthorized inspection ke liye monitored hai. Agar khud ka developer ho, admin panel use karo.', 'color:#00ff41;font-size:12px');

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
      '<p style="color:#888;max-width:420px;line-height:1.6">Is website ka content protected hai.<br>DevTools band karo — page apne aap wapas aa jayega.</p>';
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

  setInterval(function () { isOpen() ? show() : hide(); }, 1200);
})();
