(function () {
  'use strict';

  var listeners = [];
  var online = navigator.onLine;

  function banner() {
    return document.getElementById('offline-banner');
  }

  function render() {
    var b = banner();
    if (b) b.classList.toggle('d-none', online);
    document.querySelectorAll('.connection-dot').forEach(function (dot) {
      dot.classList.toggle('offline', !online);
      dot.title = online ? 'Online' : 'Offline';
    });
  }

  function update(state) {
    if (state === online) return;
    online = state;
    render();
    listeners.forEach(function (cb) {
      try { cb(online); } catch (e) { /* listener error */ }
    });
  }

  window.addEventListener('online', function () { update(true); });
  window.addEventListener('offline', function () { update(false); });
  document.addEventListener('DOMContentLoaded', render);

  window.connectionStatus = {
    isOnline: function () { return online; },
    onChange: function (cb) {
      listeners.push(cb);
      cb(online);
    },
  };
})();
