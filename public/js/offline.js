(function () {
  'use strict';

  var btn = document.getElementById('retry');
  if (!btn) return;

  btn.addEventListener('click', function () {
    btn.disabled = true;
    btn.textContent = 'Checking…';
    fetch('/', { cache: 'no-store' })
      .then(function (res) {
        if (res.ok) window.location.href = '/';
        else {
          btn.textContent = 'Still offline — try again';
          btn.disabled = false;
        }
      })
      .catch(function () {
        btn.textContent = 'Still offline — try again';
        btn.disabled = false;
      });
  });
})();
