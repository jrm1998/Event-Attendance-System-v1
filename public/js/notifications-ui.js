(function () {
  'use strict';
  if (!document.body || !document.body.getAttribute('data-user-id')) return;

  var badge = document.getElementById('notif-badge');
  if (!badge) return;

  async function refresh() {
    try {
      var res = await fetch('/api/notifications/unread-count', { credentials: 'same-origin' });
      if (!res.ok) return;
      var data = await res.json();
      var count = data.count || 0;
      badge.textContent = count > 99 ? '99+' : count;
      badge.classList.toggle('d-none', count === 0);
    } catch (e) {
      /* offline: leave badge as-is */
    }
  }

  refresh();
  setInterval(refresh, 60000);
  window.notificationsUi = { refresh };
})();
