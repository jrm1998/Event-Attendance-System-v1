(function () {
  'use strict';

  var list = document.getElementById('notification-list');
  var loadMoreBtn = document.getElementById('load-more-btn');
  var shown = loadMoreBtn ? Number(loadMoreBtn.getAttribute('data-shown')) : 0;
  var total = loadMoreBtn ? Number(loadMoreBtn.getAttribute('data-total')) : 0;

  function escapeHtml(t) {
    var d = document.createElement('div');
    d.textContent = t == null ? '' : String(t);
    return d.innerHTML;
  }

  function itemHtml(n) {
    return (
      '<div class="list-group-item ' + (n.read ? '' : 'fw-semibold bg-light') + '" data-id="' + n.id + '">' +
      '<div class="d-flex justify-content-between gap-2"><div>' +
      '<div>' + escapeHtml(n.title) + '</div>' +
      '<div class="small text-muted fw-normal">' + escapeHtml(n.message) + '</div>' +
      '</div><div class="text-end text-nowrap">' +
      (n.read ? '' : '<button class="btn btn-sm btn-link p-0 mark-read-btn" data-id="' + n.id + '">Mark read</button>') +
      '</div></div></div>'
    );
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function () {
      loadMoreBtn.disabled = true;
      var page = Number(loadMoreBtn.getAttribute('data-page'));
      window.api('/api/notifications?page=' + (page + 1) + '&limit=20').then(function (data) {
        data.rows.forEach(function (n) {
          list.insertAdjacentHTML('beforeend', itemHtml(n));
        });
        shown += data.rows.length;
        loadMoreBtn.setAttribute('data-page', String(page + 1));
        if (shown >= data.total) loadMoreBtn.classList.add('d-none');
        loadMoreBtn.disabled = false;
      }).catch(function (err) {
        loadMoreBtn.disabled = false;
        window.showToast(err.message, 'danger');
      });
    });
  }

  document.getElementById('mark-all-btn').addEventListener('click', function () {
    window.api('/api/notifications/mark-all-read', { method: 'POST', body: {} }).then(function (data) {
      window.showToast('Marked ' + data.updated + ' as read.', 'success');
      list.querySelectorAll('.list-group-item[data-id]').forEach(function (el) {
        el.classList.remove('fw-semibold', 'bg-light');
      });
      list.querySelectorAll('.mark-read-btn').forEach(function (b) { b.remove(); });
      if (window.notificationsUi) window.notificationsUi.refresh();
    }).catch(function (err) {
      window.showToast(err.message, 'danger');
    });
  });

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('.mark-read-btn');
    if (!btn) return;
    window.api('/api/notifications/mark-read', { method: 'POST', body: { id: Number(btn.getAttribute('data-id')) } })
      .then(function () {
        var item = btn.closest('.list-group-item');
        if (item) item.classList.remove('fw-semibold', 'bg-light');
        btn.remove();
        if (window.notificationsUi) window.notificationsUi.refresh();
      })
      .catch(function (err) { window.showToast(err.message, 'danger'); });
  });

  // --- Preferences -------------------------------------------------------------

  var toggles = { inApp: document.getElementById('pref-inapp'), email: document.getElementById('pref-email'), push: document.getElementById('pref-push') };

  function savePreferences() {
    var body = { inApp: toggles.inApp.checked, email: toggles.email.checked, push: toggles.push.checked };
    if (!body.inApp && !body.email && !body.push) {
      window.showToast('At least one channel must stay enabled.', 'warning');
      toggles.inApp.checked = true;
      return;
    }
    window.api('/api/notifications/preferences', { method: 'PUT', body: body })
      .then(function () { window.showToast('Preferences saved.', 'success'); })
      .catch(function (err) {
        window.showToast(err.message, 'danger');
        window.location.reload();
      });
  }

  Object.keys(toggles).forEach(function (k) {
    toggles[k].addEventListener('change', savePreferences);
  });

  // --- Web push ------------------------------------------------------------------

  var enableBtn = document.getElementById('enable-push-btn');
  if (enableBtn) {
    enableBtn.addEventListener('click', async function () {
      enableBtn.disabled = true;
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
          throw new Error('This browser does not support push notifications.');
        }
        var reg = await navigator.serviceWorker.register('/service-worker.js');
        var permission = await window.Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notification permission was denied.');
        var keyRes = await window.api('/api/push/vapid-public');
        if (!keyRes.publicKey) throw new Error('Push is not configured on this server.');
        var sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
        });
        await window.api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
        var status = document.getElementById('push-status');
        if (status) {
          status.textContent = 'Push enabled for this device.';
          status.classList.remove('d-none');
        }
        if (!toggles.push.checked) {
          toggles.push.checked = true;
          savePreferences();
        }
        window.showToast('Push notifications enabled.', 'success');
      } catch (err) {
        window.showToast(err.message || 'Could not enable push.', 'danger');
      } finally {
        enableBtn.disabled = false;
      }
    });
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = window.atob(base64);
    var outputArray = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) outputArray[i] = raw.charCodeAt(i);
    return outputArray;
  }

  // --- Live in-app updates ---------------------------------------------------------

  if (window.liveSocket) {
    window.liveSocket.on('notification:new', function () {
      window.setTimeout(function () { window.location.reload(); }, 600);
    });
  }
})();
