(function () {
  'use strict';

  document.querySelectorAll('.review-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var decision = btn.getAttribute('data-decision');
      var name = btn.getAttribute('data-name');
      var reason = window.prompt(
        (decision === 'approve' ? 'Approve' : 'Reject') + ' the attendance of ' + name + '?\nReason (required, audited):'
      );
      if (reason === null) return;
      reason = reason.trim();
      if (reason.length < 5) {
        window.showToast('A reason of at least 5 characters is required.', 'warning');
        return;
      }
      btn.disabled = true;
      window.api('/api/attendance/' + btn.getAttribute('data-id') + '/review', {
        method: 'POST',
        body: { decision: decision, reason: reason },
      }).then(function () {
        window.showToast((decision === 'approve' ? 'Approved' : 'Rejected') + ': ' + name, 'success');
        var row = document.querySelector('tr[data-row="' + btn.getAttribute('data-id') + '"]');
        if (row) row.remove();
      }).catch(function (err) {
        btn.disabled = false;
        window.showToast(err.message, 'danger');
      });
    });
  });
})();
