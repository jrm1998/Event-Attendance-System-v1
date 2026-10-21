(function () {
  'use strict';

  var configEl = document.getElementById('scan-config');
  if (!configEl) return;

  var eventId = parseInt(configEl.getAttribute('data-event-id'), 10);
  var mode = configEl.getAttribute('data-mode') === 'checkout' ? 'checkout' : 'checkin';

  var introEl = document.getElementById('scan-intro');
  var readerEl = document.getElementById('qr-reader');
  var gpsEl = document.getElementById('gps-progress');
  var gpsTextEl = document.getElementById('gps-progress-text');
  var resultEl = document.getElementById('result-panel');
  var retryBtn = document.getElementById('retry-btn');
  var offlineWarning = document.getElementById('offline-warning');
  var startBtn = document.getElementById('start-scan-btn');

  var scanner = null;
  var running = false;
  var submitting = false;

  function show(el) { el.classList.remove('d-none'); }
  function hide(el) { el.classList.add('d-none'); }

  function setStage(stage) {
    // stage: 'intro' | 'camera' | 'gps' | 'result'
    if (stage === 'intro') { show(introEl); hide(readerEl); hide(gpsEl); hide(resultEl); }
    if (stage === 'camera') { hide(introEl); show(readerEl); hide(gpsEl); hide(resultEl); }
    if (stage === 'gps') { hide(introEl); hide(readerEl); show(gpsEl); hide(resultEl); }
    if (stage === 'result') { hide(introEl); hide(readerEl); hide(gpsEl); show(resultEl); }
    if (stage !== 'result') { hide(retryBtn); }
  }

  function renderResult(kind, html) {
    var cls = {
      success: 'success',
      late: 'warning',
      pending: 'warning',
      error: 'danger',
    }[kind] || 'secondary';
    var icon = {
      success: 'bi-check-circle-fill',
      late: 'bi-alarm',
      pending: 'bi-hourglass-split',
      error: 'bi-x-octagon-fill',
    }[kind] || 'bi-info-circle';
    resultEl.innerHTML =
      '<div class="alert alert-' + cls + '" role="alert">' +
      '<h2 class="h6 alert-heading"><i class="bi ' + icon + ' me-1"></i>' + html.title + '</h2>' +
      '<p class="mb-0 small">' + html.body + '</p>' +
      '</div>';
    setStage('result');
  }

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  function stopCamera() {
    if (!scanner) return Promise.resolve();
    var s = scanner;
    scanner = null;
    return s.stop().then(function () { s.clear(); }).catch(function () { /* already stopped */ });
  }

  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('This browser does not support location access.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
    });
  }

  function submit(qrPayload) {
    if (submitting) return;
    if (!window.connectionStatus || !window.connectionStatus.isOnline()) {
      renderResult('error', {
        title: 'You are offline',
        body: 'Attendance cannot be submitted without a live connection. Reconnect and try again — your attendance is never stored on this device.',
      });
      show(retryBtn);
      return;
    }
    submitting = true;
    setStage('gps');
    gpsTextEl.textContent = 'Getting your location…';

    getPosition().then(function (pos) {
      gpsTextEl.textContent = 'Verifying with the server…';
      var body = {
        qr: qrPayload,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: new Date(pos.timestamp).toISOString(),
      };
      var endpoint = mode === 'checkout' ? '/api/attendance/check-out' : '/api/attendance/check-in';
      return window.api(endpoint, { method: 'POST', body: body });
    }).then(function (data) {
      submitting = false;
      var record = data && data.attendance ? data.attendance : data;
      var status = record && record.status ? record.status : null;
      var time = record && record.checkinAt ? new Date(record.checkinAt).toLocaleTimeString() : '';
      var needsCheckout = !!(data && data.event && data.event.checkoutRequired);

      if (mode === 'checkout') {
        renderResult('success', {
          title: 'Checked out',
          body: 'Your check-out has been recorded' + (time ? ' at ' + escapeHtml(time) : '') + '. You can close this page.',
        });
      } else if (status === 'late') {
        renderResult('late', {
          title: 'Checked in — late',
          body: 'You are checked in, but after the late cut-off, so your status is <strong>late</strong>.' + (time ? ' Recorded at ' + escapeHtml(time) + '.' : ''),
        });
      } else if (status === 'pending_review') {
        renderResult('pending', {
          title: 'Received — pending review',
          body: 'Your location could not be fully verified, so your attendance was queued for coordinator review. You will see the decision in your history.',
        });
      } else {
        renderResult('success', {
          title: 'Checked in',
          body: 'Your attendance has been recorded' + (time ? ' at ' + escapeHtml(time) : '') + '. Keep this confirmation visible if asked.' + (needsCheckout ? '<br><span class="small">Remember to check out with the QR code before the event ends.</span>' : ''),
        });
      }
    }).catch(function (err) {
      submitting = false;
      var msg = err && err.message ? err.message : 'Something went wrong.';
      var geoErrors = {
        1: 'Location permission was denied. Attendance needs your location — enable it for this site and try again.',
        2: 'Your position is unavailable. Move to an area with better signal and try again.',
        3: 'Getting your location timed out. Try again, preferably outdoors or near a window.',
      };
      if (err && (err.code === 1 || err.code === 2 || err.code === 3)) {
        msg = geoErrors[err.code];
      }
      renderResult('error', { title: 'Not recorded', body: escapeHtml(msg) });
      show(retryBtn);
    });
  }

  function startScanning() {
    if (running) return;
    if (typeof Html5Qrcode === 'undefined') {
      renderResult('error', { title: 'Scanner unavailable', body: 'The QR scanner library failed to load. Check your connection and reload the page.' });
      show(retryBtn);
      return;
    }
    if (!window.connectionStatus || !window.connectionStatus.isOnline()) {
      renderResult('error', {
        title: 'You are offline',
        body: 'Attendance needs a live connection. Reconnect and try again.',
      });
      show(retryBtn);
      return;
    }
    running = true;
    setStage('camera');
    scanner = new Html5Qrcode('qr-reader', { verbose: false });
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      function (decodedText) {
        if (running) {
          running = false;
          stopCamera().then(function () { submit(decodedText); });
        }
      },
      function () { /* per-frame decode failures are normal */ }
    ).catch(function (err) {
      running = false;
      scanner = null;
      var msg = 'The camera could not be started. ' +
        'Attendance requires the QR code — make sure camera permission is granted for this site and no other app is using the camera.';
      if (err && String(err).indexOf('NotAllowed') !== -1) {
        msg = 'Camera permission was denied. Enable the camera for this site in your browser settings and try again.';
      }
      renderResult('error', { title: 'Camera unavailable', body: escapeHtml(msg) });
      show(retryBtn);
    });
  }

  function reset() {
    stopCamera().then(function () {
      running = false;
      submitting = false;
      setStage('intro');
    });
  }

  startBtn.addEventListener('click', startScanning);
  retryBtn.addEventListener('click', reset);

  if (window.connectionStatus) {
    window.connectionStatus.onChange(function (online) {
      if (offlineWarning) offlineWarning.classList.toggle('d-none', online);
    });
  }
})();
