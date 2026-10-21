(function () {
  'use strict';

  var form = document.getElementById('student-form');
  if (!form) return;

  var isEdit = !!form.getAttribute('data-student-id');
  var gradeSelect = document.getElementById('gradeLevelId');
  var sectionSelect = document.getElementById('sectionId');

  function filterSections() {
    var gradeId = gradeSelect.value;
    Array.prototype.forEach.call(sectionSelect.options, function (opt) {
      if (!opt.value) return;
      var match = !gradeId || opt.getAttribute('data-grade') === gradeId;
      opt.hidden = !match;
      if (!match) opt.selected = false;
    });
  }
  gradeSelect.addEventListener('change', filterSections);
  filterSections();

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var submitBtn = form.querySelector('#submit-btn');
    submitBtn.disabled = true;
    var body = {};
    new FormData(form).forEach(function (value, key) {
      if (key === 'studentNumber' && isEdit) return;
      body[key] = value;
    });
    try {
      if (isEdit) {
        await api('/api/students/' + form.getAttribute('data-student-id'), { method: 'PUT', body: body });
        showToast('Student updated.', 'success');
        setTimeout(function () { window.location.href = '/admin/students'; }, 700);
      } else {
        await api('/api/students', { method: 'POST', body: body });
        showToast('Student created.', 'success');
        setTimeout(function () { window.location.href = '/admin/students'; }, 700);
      }
    } catch (err) {
      showToast(err.message, 'danger');
      submitBtn.disabled = false;
    }
  });
})();
