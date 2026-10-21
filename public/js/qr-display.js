(function () {
  'use strict';

  var body = document.body;
  var config = document.querySelector('[data-subscribe-event]');
  var eventId = config ? Number(config.getAttribute('data-subscribe-event')) : null;
  var image = document.getElementById('qr-image');
  if (!image || !eventId) return;

  var loading = document.getElementById('qr-loading');
  var countdownEl = document.getElementById('qr-countdown');
  var bar = document.getElementById('qr-countdown-bar');
  var rotationSeconds = Number((config && config.getAttribute('data-qr-rotation')) || 45);
  var rotateTimer = null;
  var tickTimer = null;
  var rotating = false;

  async function rotate() {
    if (rotating) return;
    rotating = true;
    loading.classList.remove('d-none');
    try {
      var data = await api('/api/events/' + eventId + '/qr/issue', { method: 'POST' });
      image.src = data.dataUrl;
      rotationSeconds = data.rotationSeconds || rotationSeconds;
      startCountdown();
    } catch (err) {
      if (tickTimer === null) startCountdown(); // keep retrying on schedule
      console && console.warn('QR issue failed:', err.message);
    } finally {
      loading.classList.add('d-none');
      rotating = false;
    }
  }

  function startCountdown() {
    if (tickTimer) clearInterval(tickTimer);
    var remaining = rotationSeconds;
    var total = rotationSeconds;
    tickTimer = setInterval(function () {
      remaining -= 1;
      if (countdownEl) countdownEl.textContent = Math.max(0, remaining);
      if (bar) bar.style.width = Math.max(0, (remaining / total) * 100) + '%';
      if (remaining <= 0) {
        clearInterval(tickTimer);
        rotate();
      }
    }, 1000);
  }

  rotate();

  // Live counters
  function onStats(payload) {
    if (!payload || Number(payload.eventId) !== eventId) return;
    var present = (payload.stats.present || 0) + (payload.stats.late || 0) + (payload.stats.checked_out || 0);
    var p = document.getElementById('qr-stat-present');
    var l = document.getElementById('qr-stat-late');
    if (p) p.textContent = present;
    if (l) l.textContent = payload.stats.late || 0;
  }
  if (window.liveSocket) window.liveSocket.on('attendance:update', onStats);

  var fsBtn = document.getElementById('fullscreen-btn');
  if (fsBtn) {
    fsBtn.addEventListener('click', function () {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen && document.exitFullscreen();
      }
    });
  }
})();
