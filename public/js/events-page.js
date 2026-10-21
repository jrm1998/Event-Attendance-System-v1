(function () {
  'use strict';

  document.querySelectorAll('.event-card [data-action]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var card = btn.closest('.event-card');
      var eventId = card.getAttribute('data-event-id');
      var action = btn.getAttribute('data-action');
      var messages = {
        publish: 'Publish this event? Students will see it and check-in will follow the schedule.',
        cancel: 'Cancel this event? Published events that are cancelled cannot accept attendance.',
        complete: 'Mark this event as completed? Check-in will stop.',
        archive: 'Archive this event? It stays in reports but is hidden from active lists.',
      };
      if (!(await confirmDialog(messages[action] || 'Proceed?'))) return;
      try {
        await api('/api/events/' + eventId + '/status/' + action, { method: 'POST' });
        window.location.reload();
      } catch (err) {
        showToast(err.message, 'danger');
      }
    });
  });
})();
