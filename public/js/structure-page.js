(function () {
  'use strict';

  var yearForm = document.getElementById('year-form');
  if (yearForm) {
    yearForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var body = {};
      new FormData(yearForm).forEach(function (v, k) { body[k] = v; });
      try {
        await api('/api/structure/school-years', { method: 'POST', body: body });
        window.location.reload();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  document.querySelectorAll('[data-activate-year]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      if (!(await confirmDialog('Set this school year as the active one? Others will be closed.'))) return;
      try {
        await api('/api/structure/school-years/' + btn.getAttribute('data-activate-year') + '/activate', { method: 'POST' });
        window.location.reload();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  });

  var gradeForm = document.getElementById('grade-form');
  if (gradeForm) {
    gradeForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var body = {};
      new FormData(gradeForm).forEach(function (v, k) { body[k] = v; });
      try {
        await api('/api/structure/grade-levels', { method: 'POST', body: body });
        window.location.reload();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  var sectionForm = document.getElementById('section-form');
  if (sectionForm) {
    sectionForm.addEventListener('submit', async function (event) {
      event.preventDefault();
      var body = {};
      new FormData(sectionForm).forEach(function (v, k) { body[k] = v; });
      try {
        await api('/api/structure/sections', { method: 'POST', body: body });
        window.location.reload();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  }

  document.querySelectorAll('[data-toggle-section]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await api('/api/structure/sections/' + btn.getAttribute('data-toggle-section'), {
          method: 'PUT',
          body: { status: btn.getAttribute('data-next') },
        });
        window.location.reload();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  });
})();
