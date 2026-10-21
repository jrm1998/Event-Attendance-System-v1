(function () {
  'use strict';
  // Socket.IO client bootstrap shared by admin/teacher live pages.
  window.liveSocket = null;
  if (typeof io === 'undefined') return;
  window.liveSocket = io({ transports: ['websocket', 'polling'] });

  window.liveSocket.on('connect', function () {
    document.querySelectorAll('[data-subscribe-event]').forEach(function (el) {
      window.liveSocket.emit('event:subscribe', { eventId: Number(el.getAttribute('data-subscribe-event')) });
    });
  });

  window.liveSocket.on('event:denied', function (payload) {
    console && console.warn('Not authorized for live updates of event', payload && payload.eventId);
  });
})();
