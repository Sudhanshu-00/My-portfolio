/* ============ Admin panel helpers (external — CSP has no unsafe-inline) ============ */
(function () {
  'use strict';

  // ---- confirmation dialogs: any form with [data-confirm] asks before submitting ----
  document.addEventListener(
    'submit',
    function (e) {
      var form = e.target;
      if (!form || !form.getAttribute) return;
      var msg = form.getAttribute('data-confirm');
      if (msg && !window.confirm(msg)) e.preventDefault();
    },
    true
  );

  // ---- site settings: custom social links (add / remove rows) ----
  var list = document.getElementById('custom-links');
  var addBtn = document.getElementById('cl-add');
  if (list && addBtn) {
    addBtn.addEventListener('click', function () {
      var row = document.createElement('div');
      row.className = 'cl-row';
      row.innerHTML =
        '<input type="text" name="custom_label" maxlength="40" placeholder="Label (e.g. YouTube)">' +
        '<input type="text" name="custom_url" maxlength="500" placeholder="https://...">' +
        '<button type="button" class="btn small danger cl-del">✕</button>';
      list.appendChild(row);
    });
    list.addEventListener('click', function (e) {
      if (e.target.classList && e.target.classList.contains('cl-del')) e.target.parentElement.remove();
    });
  }
})();
