(function () {
  'use strict';

  var deferredPrompt = null;

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.navigator.standalone === true
    );
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  function showInstallButtons() {
    document.querySelectorAll('.pwa-install-btn').forEach(function (btn) {
      btn.classList.remove('d-none');
    });
  }

  function showPlatformHint(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('d-none');
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    if (!isStandalone()) showInstallButtons();
  });

  document.addEventListener('DOMContentLoaded', function () {
    if (isStandalone()) return;
    document.querySelectorAll('.pwa-install-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        if (!deferredPrompt) {
          if (isIos()) showPlatformHint('ios-install-hint');
          return;
        }
        deferredPrompt.prompt();
        var choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          document.querySelectorAll('.pwa-install-btn').forEach(function (b) {
            b.classList.add('d-none');
          });
        }
        deferredPrompt = null;
      });
    });
    // iOS Safari has no programmatic install prompt.
    if (isIos() && !isStandalone()) {
      var hint = document.getElementById('ios-install-hint');
      if (hint) {
        document.querySelectorAll('.pwa-install-btn').forEach(function (btn) {
          btn.classList.add('d-none');
        });
        hint.classList.remove('d-none');
      }
    }
  });

  window.addEventListener('appinstalled', function () {
    document.querySelectorAll('.pwa-install-btn').forEach(function (b) {
      b.classList.add('d-none');
    });
  });
})();
