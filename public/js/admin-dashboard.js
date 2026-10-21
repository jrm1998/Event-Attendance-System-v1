(function () {
  'use strict';

  var chart = null;

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function render(a) {
    setText('stat-students', a.students.active);
    setText('stat-events', a.events.total);
    setText('stat-upcoming', a.events.upcoming);
    setText('stat-pending', a.attendance.pendingReview);
    setText('att-present', a.attendance.present);
    setText('att-late', a.attendance.late);
    setText('att-checkedout', a.attendance.checkedOut);
    setText('att-absent', a.attendance.absent);

    var total =
      a.attendance.present + a.attendance.late + a.attendance.checkedOut + a.attendance.absent;
    var bars = {
      'bar-present': a.attendance.present,
      'bar-late': a.attendance.late,
      'bar-checkedout': a.attendance.checkedOut,
      'bar-absent': a.attendance.absent,
    };
    Object.keys(bars).forEach(function (id) {
      var bar = document.getElementById(id);
      if (bar) bar.style.width = total ? ((bars[id] / total) * 100).toFixed(1) + '%' : '0%';
    });

    if (chart) {
      chart.data.datasets[0].data = [
        a.attendance.present,
        a.attendance.late,
        a.attendance.checkedOut,
        a.attendance.absent,
        a.attendance.pendingReview,
      ];
      chart.update('none');
    }
  }

  var canvas = document.getElementById('attendance-chart');
  if (canvas && typeof Chart !== 'undefined') {
    chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Present', 'Late', 'Checked out', 'Absent', 'Pending review'],
        datasets: [
          {
            data: [0, 0, 0, 0, 0],
            backgroundColor: ['#198754', '#e8a020', '#0d6efd', '#6c757d', '#ffc107'],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } },
      },
    });
  }

  async function refresh() {
    try {
      var summary = await window.api('/api/admin/summary');
      render(summary);
      var stamp = document.getElementById('summary-updated');
      if (stamp) stamp.textContent = 'updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      /* transient network/session errors: keep last rendered values */
    }
  }

  render({
    students: { active: Number((document.getElementById('stat-students') || {}).textContent || 0) },
    events: {
      total: Number((document.getElementById('stat-events') || {}).textContent || 0),
      upcoming: Number((document.getElementById('stat-upcoming') || {}).textContent || 0),
    },
    attendance: {
      present: Number((document.getElementById('att-present') || {}).textContent || 0),
      late: Number((document.getElementById('att-late') || {}).textContent || 0),
      checkedOut: Number((document.getElementById('att-checkedout') || {}).textContent || 0),
      absent: Number((document.getElementById('att-absent') || {}).textContent || 0),
      pendingReview: Number((document.getElementById('stat-pending') || {}).textContent || 0),
    },
  });

  refresh();
  window.setInterval(refresh, 30000);
})();
