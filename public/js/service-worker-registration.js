(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  if (location.search.indexOf('nosw=1') >= 0) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister(); });
    });
    return;
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then(function (registration) {
        registration.addEventListener('updatefound', function () {
          var newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast(registration);
            }
          });
        });
      })
      .catch(function () {
        /* service worker is an enhancement; ignore registration failures */
      });
  });

  function showUpdateToast(registration) {
    if (document.getElementById('sw-update-toast')) return;
    var div = document.createElement('div');
    div.id = 'sw-update-toast';
    div.className = 'toast show position-fixed bottom-0 end-0 m-3';
    div.setAttribute('role', 'alert');
    div.style.zIndex = '2000';
    div.innerHTML =
      '<div class="toast-body d-flex align-items-center gap-2">' +
      '<i class="bi bi-arrow-down-up"></i><span class="me-auto">A new version is available.</span>' +
      '<button type="button" class="btn btn-primary btn-sm" id="sw-update-reload">Refresh</button>' +
      '<button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>' +
      '</div>';
    document.body.appendChild(div);
    document.getElementById('sw-update-reload').addEventListener('click', function () {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    });
  }
})();
