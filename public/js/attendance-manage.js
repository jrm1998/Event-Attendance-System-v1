(function () {
  'use strict';

  var configEl = document.getElementById('manage-config');
  if (!configEl) return;
  var eventId = parseInt(configEl.getAttribute('data-event-id'), 10);

  var searchInput = document.getElementById('student-search');
  var resultsEl = document.getElementById('search-results');
  var selectedEl = document.getElementById('selected-student');
  var manualForm = document.getElementById('manual-form');
  var statusSelect = document.getElementById('manual-status');
  var reasonInput = document.getElementById('manual-reason');
  var refreshHint = document.getElementById('refresh-hint');
  var refreshBtn = document.getElementById('refresh-table-btn');

  var selectedStudent = null;
  var searchTimer = null;

  function askReason(promptText) {
    var reason = window.prompt(promptText);
    if (reason === null) return null;
    reason = reason.trim();
    if (reason.length < 5) {
      window.showToast('A reason of at least 5 characters is required.', 'warning');
      return null;
    }
    return reason;
  }

  function refreshStats(stats) {
    if (!stats) return;
    Object.keys(stats).forEach(function (key) {
      var el = document.querySelector('[data-stat="' + key + '"]');
      if (el) el.textContent = stats[key];
    });
  }

  // --- Student search -----------------------------------------------------

  function renderResults(rows) {
    resultsEl.innerHTML = '';
    if (!rows.length) {
      resultsEl.innerHTML = '<div class="list-group-item small text-muted">No eligible matches.</div>';
      return;
    }
    rows.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'list-group-item list-group-item-action';
      btn.innerHTML =
        '<div class="small fw-semibold">' + escapeHtml(s.firstName) + ' ' + escapeHtml(s.lastName) +
        ' (' + escapeHtml(s.studentNumber) + ')</div>' +
        '<div class="small text-muted">' + escapeHtml([s.gradeLevelName, s.sectionName].filter(Boolean).join(' · ')) + '</div>';
      btn.addEventListener('click', function () {
        selectedStudent = s;
        selectedEl.textContent = s.firstName + ' ' + s.lastName + ' (' + s.studentNumber + ')';
        searchInput.value = s.firstName + ' ' + s.lastName + ' (' + s.studentNumber + ')';
        resultsEl.innerHTML = '';
      });
      resultsEl.appendChild(btn);
    });
  }

  searchInput.addEventListener('input', function () {
    selectedStudent = null;
    selectedEl.textContent = 'none';
    clearTimeout(searchTimer);
    var term = searchInput.value.trim();
    if (term.length < 2) {
      resultsEl.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(function () {
      window.api('/api/events/' + eventId + '/students/search?q=' + encodeURIComponent(term))
        .then(function (data) { renderResults(data.rows || []); })
        .catch(function (err) { window.showToast(err.message, 'danger'); });
    }, 250);
  });

  document.addEventListener('click', function (e) {
    if (!resultsEl.contains(e.target) && e.target !== searchInput) resultsEl.innerHTML = '';
  });

  manualForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!selectedStudent) {
      window.showToast('Select a student from the search results first.', 'warning');
      return;
    }
    var reason = reasonInput.value.trim();
    if (reason.length < 5) {
      window.showToast('A reason of at least 5 characters is required.', 'warning');
      return;
    }
    window.api('/api/events/' + eventId + '/attendance/manual', {
      method: 'POST',
      body: { studentId: selectedStudent.id, status: statusSelect.value, reason: reason },
    }).then(function () {
      window.showToast('Recorded ' + statusSelect.value + ' for ' + selectedStudent.firstName + ' ' + selectedStudent.lastName + '.', 'success');
      window.setTimeout(function () { window.location.reload(); }, 800);
    }).catch(function (err) {
      window.showToast(err.message, 'danger');
    });
  });

  // --- Review decisions -----------------------------------------------------

  document.querySelectorAll('.review-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var decision = btn.getAttribute('data-decision');
      var name = btn.getAttribute('data-name');
      var reason = askReason(
        (decision === 'approve' ? 'Approve' : 'Reject') + ' the attendance of ' + name + '?\nReason (required, audited):'
      );
      if (reason === null) return;
      btn.disabled = true;
      window.api('/api/attendance/' + btn.getAttribute('data-id') + '/review', {
        method: 'POST',
        body: { decision: decision, reason: reason },
      }).then(function () {
        window.showToast((decision === 'approve' ? 'Approved' : 'Rejected') + ': ' + name, 'success');
        var row = btn.closest('tr');
        if (row) row.remove();
        window.setTimeout(function () { window.location.reload(); }, 800);
      }).catch(function (err) {
        btn.disabled = false;
        window.showToast(err.message, 'danger');
      });
    });
  });

  // --- Manual checkout / corrections ---------------------------------------

  document.querySelectorAll('.checkout-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var reason = askReason('Record a manual check-out for ' + btn.getAttribute('data-name') + '?\nReason (required, audited):');
      if (reason === null) return;
      btn.disabled = true;
      window.api('/api/attendance/' + btn.getAttribute('data-id') + '/checkout', {
        method: 'POST',
        body: { reason: reason },
      }).then(function () {
        window.showToast('Check-out recorded.', 'success');
        window.setTimeout(function () { window.location.reload(); }, 800);
      }).catch(function (err) {
        btn.disabled = false;
        window.showToast(err.message, 'danger');
      });
    });
  });

  document.querySelectorAll('.correct-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var status = btn.getAttribute('data-status');
      var reason = askReason('Mark ' + btn.getAttribute('data-name') + ' as ' + status + '?\nReason (required, audited):');
      if (reason === null) return;
      btn.disabled = true;
      window.api('/api/attendance/' + btn.getAttribute('data-id') + '/status', {
        method: 'POST',
        body: { status: status, reason: reason },
      }).then(function () {
        window.showToast('Status corrected to ' + status + '.', 'success');
        window.setTimeout(function () { window.location.reload(); }, 800);
      }).catch(function (err) {
        btn.disabled = false;
        window.showToast(err.message, 'danger');
      });
    });
  });

  // --- Audit trail -----------------------------------------------------------

  var auditModalEl = document.getElementById('audit-modal');
  var auditModal = auditModalEl ? new bootstrap.Modal(auditModalEl) : null;
  var auditBody = document.getElementById('audit-body');

  document.querySelectorAll('.audit-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      auditBody.innerHTML = '<div class="text-muted small">Loading…</div>';
      auditModal.show();
      window.api('/api/attendance/' + btn.getAttribute('data-id') + '/audit').then(function (data) {
        if (!data.rows || !data.rows.length) {
          auditBody.innerHTML = '<div class="text-muted small">No audit entries recorded.</div>';
          return;
        }
        var html = '<ul class="list-unstyled mb-0 small">';
        data.rows.forEach(function (l) {
          var when = new Date(l.created_at).toLocaleString();
          var details = '';
          if (l.old_values || l.new_values) {
            details = '<div class="text-muted">' + escapeHtml(JSON.stringify(l.old_values)) +
              ' &rarr; ' + escapeHtml(JSON.stringify(l.new_values)) + '</div>';
          }
          html += '<li class="mb-2"><span class="badge bg-secondary">' + escapeHtml(l.action) + '</span> ' +
            escapeHtml(l.actor_username) + ' (' + escapeHtml(l.actor_role) + ') · ' + when +
            '<div>' + escapeHtml(l.reason) + '</div>' + details + '</li>';
        });
        auditBody.innerHTML = html + '</ul>';
      }).catch(function (err) {
        auditBody.innerHTML = '<div class="text-danger small">' + escapeHtml(err.message) + '</div>';
      });
    });
  });

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = String(text == null ? '' : text);
    return div.innerHTML;
  }

  // --- Live stats ------------------------------------------------------------

  refreshBtn.addEventListener('click', function () { window.location.reload(); });

  if (window.liveSocket) {
    window.liveSocket.on('attendance:update', function (payload) {
      if (payload && payload.eventId === eventId) {
        refreshStats(payload.stats);
        if (refreshHint) refreshHint.classList.remove('d-none');
      }
    });
  }
})();
