(function () {
  'use strict';

  var form = document.getElementById('event-form');
  if (!form) return;

  var isEdit = !!form.getAttribute('data-event-id');
  var studentSearch = document.getElementById('student-search');
  var studentResults = document.getElementById('student-results');
  var chips = document.getElementById('student-chips');
  var selectedStudents = new Map();

  // Restore previously selected individual students (edit mode).
  var dataEl = document.getElementById('selected-students-data');
  if (dataEl) {
    try {
      JSON.parse(dataEl.textContent).forEach(function (s) {
        selectedStudents.set(s.id, s);
      });
    } catch (e) { /* ignore malformed */ }
  }

  function renderChips() {
    chips.innerHTML = '';
    selectedStudents.forEach(function (s) {
      var chip = document.createElement('span');
      chip.className = 'badge text-bg-secondary d-flex align-items-center gap-1';
      chip.textContent = s.studentNumber + ' ' + s.firstName + ' ' + s.lastName;
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'btn-close btn-close-white';
      x.setAttribute('aria-label', 'Remove');
      x.style.fontSize = '0.55em';
      x.addEventListener('click', function () {
        selectedStudents.delete(s.id);
        renderChips();
      });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }

  var searchTimer = null;
  studentSearch.addEventListener('input', function () {
    clearTimeout(searchTimer);
    var q = studentSearch.value.trim();
    if (q.length < 2) {
      studentResults.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(async function () {
      try {
        var data = await api('/api/events/students/search?q=' + encodeURIComponent(q));
        studentResults.innerHTML = '';
        data.rows.forEach(function (s) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-sm btn-outline-secondary d-block w-100 text-start mb-1';
          btn.textContent = s.studentNumber + ' — ' + s.firstName + ' ' + s.lastName +
            ' (' + (s.gradeLevelName || '—') + '/' + (s.sectionName || '—') + ')';
          btn.addEventListener('click', function () {
            selectedStudents.set(s.id, s);
            renderChips();
            studentResults.innerHTML = '';
            studentSearch.value = '';
          });
          studentResults.appendChild(btn);
        });
      } catch (err) {
        /* transient search errors are non-fatal */
      }
    }, 300);
  });
  renderChips();

  var useLocation = document.getElementById('use-my-location');
  useLocation.addEventListener('click', function () {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported by this browser.', 'warning');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        document.getElementById('latitude').value = pos.coords.latitude.toFixed(7);
        document.getElementById('longitude').value = pos.coords.longitude.toFixed(7);
        showToast('Coordinates captured (accuracy ' + Math.round(pos.coords.accuracy) + ' m).', 'success');
      },
      function (err) {
        showToast('Could not get location: ' + err.message, 'danger');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });

  function readCheckboxValues(selector) {
    return Array.prototype.slice
      .call(document.querySelectorAll(selector + ':checked'))
      .map(function (c) {
        return c.value;
      });
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var fd = new FormData(form);
    fd.delete('studentNumber'); // not sent on edit
    readCheckboxValues('.elig-grade').forEach(function (v) { fd.append('eligibleGradeIds[]', v); });
    readCheckboxValues('.elig-section').forEach(function (v) { fd.append('eligibleSectionIds[]', v); });
    selectedStudents.forEach(function (s) { fd.append('eligibleStudentIds[]', s.id); });
    readCheckboxValues('.teacher-check').forEach(function (v) { fd.append('teacherIds[]', v); });

    var url = isEdit ? '/api/events/' + form.getAttribute('data-event-id') : '/api/events';
    try {
      if (isEdit) {
        await api(url, { method: 'PUT', formData: fd });
        showToast('Event updated.', 'success');
      } else {
        var result = await api(url, { method: 'POST', formData: fd });
        showToast('Event created as draft. Publish it when ready.', 'success');
        setTimeout(function () { window.location.href = '/admin/events/' + result.id + '/edit'; }, 700);
        return;
      }
      setTimeout(function () { window.location.reload(); }, 700);
    } catch (err) {
      showToast(err.message, 'danger');
    }
  });
})();
