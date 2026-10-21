(function () {
  'use strict';

  var form = document.getElementById('bulk-form');
  if (!form) return;

  var checkAll = document.getElementById('check-all');
  var statusEl = document.getElementById('bulk-status');

  checkAll.addEventListener('change', function () {
    document.querySelectorAll('.row-check').forEach(function (c) {
      c.checked = checkAll.checked;
    });
    updateStatus();
  });

  function selectedIds() {
    return Array.prototype.slice
      .call(document.querySelectorAll('.row-check:checked'))
      .map(function (c) {
        return Number(c.value);
      });
  }

  function updateStatus() {
    var n = selectedIds().length;
    statusEl.textContent = n ? n + ' selected' : '';
  }

  document.querySelectorAll('.row-check').forEach(function (c) {
    c.addEventListener('change', updateStatus);
  });

  document.querySelectorAll('[data-bulk]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var ids = selectedIds();
      if (!ids.length) {
        showToast('Select at least one student first.', 'warning');
        return;
      }
      var action = btn.getAttribute('data-bulk');
      if (!(await confirmDialog('Apply "' + action + '" to ' + ids.length + ' student(s)?'))) return;
      try {
        var result = await api('/api/students/bulk', { method: 'POST', body: { action: action, ids: ids } });
        showToast('Updated ' + result.affected + ' student(s).', 'success');
        setTimeout(function () { window.location.reload(); }, 800);
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  });
})();
