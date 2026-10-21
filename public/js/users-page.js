(function () {
  'use strict';

  var roleSelect = document.getElementById('u-role');
  var userForm = document.getElementById('user-form');

  function toggleTeacherFields() {
    document.querySelectorAll('.teacher-field').forEach(function (el) {
      el.style.display = roleSelect.value === 'teacher' ? '' : 'none';
      el.querySelectorAll('input').forEach(function (i) {
        i.required = roleSelect.value === 'teacher';
      });
    });
  }
  roleSelect.addEventListener('change', toggleTeacherFields);
  toggleTeacherFields();

  userForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var body = {};
    new FormData(userForm).forEach(function (value, key) {
      body[key] = value;
    });
    try {
      await api('/api/users', { method: 'POST', body: body });
      bootstrap.Modal.getInstance(document.getElementById('user-modal')).hide();
      showToast('User created.', 'success');
      setTimeout(function () { window.location.reload(); }, 700);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });

  document.querySelectorAll('[data-action]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var row = btn.closest('tr');
      var userId = row.getAttribute('data-user-id');
      var action = btn.getAttribute('data-action');
      if (action === 'toggle-status') {
        var current = btn.getAttribute('data-status');
        var next = current === 'active' ? 'inactive' : 'active';
        if (!(await confirmDialog('Set this account to "' + next + '"?'))) return;
        try {
          await api('/api/users/' + userId + '/status', { method: 'PUT', body: { status: next } });
          window.location.reload();
        } catch (err) {
          showToast(err.message, 'danger');
        }
      } else if (action === 'reset-password') {
        var custom = window.prompt('New password (leave blank to auto-generate):');
        if (custom === null) return;
        try {
          var result = await api('/api/users/' + userId + '/reset-password', {
            method: 'POST',
            body: custom ? { newPassword: custom } : {},
          });
          if (result.generated) {
            window.alert('Generated password (share securely, it will not be shown again):\n\n' + result.generated);
          } else {
            showToast('Password updated.', 'success');
          }
        } catch (err) {
          showToast(err.message, 'danger');
        }
      }
    });
  });
})();
