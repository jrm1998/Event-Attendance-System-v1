(function () {
  'use strict';

  var fileInput = document.getElementById('import-file');
  var validateBtn = document.getElementById('validate-btn');
  var commitBtn = document.getElementById('commit-btn');
  var progress = document.getElementById('import-progress');
  var report = document.getElementById('import-report');
  if (!fileInput) return;

  function setBusy(busy) {
    progress.classList.toggle('d-none', !busy);
    validateBtn.disabled = busy;
    commitBtn.disabled = busy || commitBtn.classList.contains('d-none');
  }

  function renderReport(data) {
    var html = '<div class="alert ' +
      (data.errorCount === 0 ? 'alert-success' : 'alert-warning') + '">' +
      '<strong>' + data.totalRows + '</strong> rows found · ' +
      '<strong class="text-success">' + data.validCount + '</strong> valid · ' +
      '<strong class="text-danger">' + data.errorCount + '</strong> with errors</div>';
    if (data.errorCount > 0) {
      html += '<div class="table-responsive" style="max-height:300px; overflow:auto;"><table class="table table-sm table-bordered">' +
        '<thead><tr><th>Row</th><th>Sample</th><th>Problems</th></tr></thead><tbody>';
      data.rows.forEach(function (r) {
        if (r.errors.length) {
          html += '<tr><td>' + r.line + '</td><td>' + escapeHtml(r.sample) + '</td><td class="text-danger small">' +
            r.errors.map(escapeHtml).join('<br>') + '</td></tr>';
        }
      });
      html += '</tbody></table></div>';
    }
    report.innerHTML = html;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function needFile() {
    if (!fileInput.files.length) {
      showToast('Choose a .csv or .xlsx file first.', 'warning');
      return true;
    }
    return false;
  }

  validateBtn.addEventListener('click', async function () {
    if (needFile()) return;
    setBusy(true);
    report.innerHTML = '';
    try {
      var fd = new FormData();
      fd.append('file', fileInput.files[0]);
      var data = await api('/api/students/import/validate', { formData: fd });
      renderReport(data);
      commitBtn.classList.toggle('d-none', data.validCount === 0);
      commitBtn.disabled = false;
    } catch (err) {
      report.innerHTML = '<div class="alert alert-danger">' + escapeHtml(err.message) + '</div>';
    } finally {
      setBusy(false);
    }
  });

  commitBtn.addEventListener('click', async function () {
    if (needFile()) return;
    if (!(await confirmDialog('Import valid rows now? Rows with errors will be skipped.'))) return;
    setBusy(true);
    try {
      var fd = new FormData();
      fd.append('file', fileInput.files[0]);
      var data = await api('/api/students/import/commit', { formData: fd });
      report.innerHTML = '<div class="alert alert-success">Imported <strong>' + data.created +
        '</strong> student(s); skipped ' + data.skipped + '.</div>';
      commitBtn.classList.add('d-none');
    } catch (err) {
      report.innerHTML = '<div class="alert alert-danger">' + escapeHtml(err.message) + '</div>';
    } finally {
      setBusy(false);
    }
  });
})();
