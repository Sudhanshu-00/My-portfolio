/* Threat Feed — client-side filters + auto-refresh poll.
   CSP-safe: koi inline script nahi, sab kuch isi file me. */
(function () {
  'use strict';

  var grid = document.getElementById('feed-grid');
  if (!grid) return;

  var tabs = document.getElementById('feed-tabs');
  var search = document.getElementById('feed-search');
  var empty = document.getElementById('feed-empty');
  var noResult = document.getElementById('feed-noresult');
  var newBar = document.getElementById('feed-newbar');
  var newCount = document.getElementById('feed-newcount');
  var reloadBtn = document.getElementById('feed-reload');
  var syncEl = document.getElementById('feed-sync');

  var PAGE_LOADED_AT = Date.now();
  var activeKind = 'all';

  // ---- filter: kind tab + text search (sab client-side, instant) ----
  function applyFilter() {
    var q = (search && search.value || '').trim().toLowerCase();
    var cards = grid.querySelectorAll('.feed-card');
    var visible = 0;
    cards.forEach(function (c) {
      var okKind = activeKind === 'all' || c.getAttribute('data-kind') === activeKind;
      var okText = !q || (c.getAttribute('data-search') || '').indexOf(q) !== -1;
      var show = okKind && okText;
      c.hidden = !show;
      if (show) visible++;
    });
    if (noResult) noResult.hidden = visible !== 0;
    if (empty) empty.hidden = visible !== 0 || parseInt(empty.getAttribute('data-total') || '0', 10) !== 0;
  }

  if (tabs) {
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-kind]');
      if (!b) return;
      activeKind = b.getAttribute('data-kind');
      tabs.querySelectorAll('button').forEach(function (x) { x.classList.add('ghost'); });
      b.classList.remove('ghost');
      applyFilter();
    });
  }
  if (search) search.addEventListener('input', applyFilter);
  applyFilter();

  // ---- auto-refresh poll: har 90 sec me new items check ----
  function poll() {
    fetch('/blog/data?since=' + PAGE_LOADED_AT, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok) return;
        if (syncEl && d.lastRefreshAt) {
          var mins = Math.max(0, Math.round((Date.now() - new Date(d.lastRefreshAt).getTime()) / 60000));
          syncEl.textContent = 'sync: ' + (mins === 0 ? 'just now' : mins + 'm ago');
        }
        if (d.newer > 0 && newBar && newCount) {
          newCount.textContent = d.newer;
          newBar.hidden = false;
        }
      })
      .catch(function () {});
  }
  setInterval(poll, 90000);
  poll();

  if (reloadBtn) reloadBtn.addEventListener('click', function () { location.reload(); });
})();
