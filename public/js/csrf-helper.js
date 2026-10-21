(function () {
  'use strict';
  var token = document.body ? document.body.getAttribute('data-csrf') : null;
  if (!token || !window.fetch) return;

  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    init = init || {};
    var headers;
    if (init.headers instanceof Headers) {
      headers = init.headers;
    } else if (Array.isArray(init.headers)) {
      headers = new Headers(init.headers);
    } else if (init.headers) {
      headers = new Headers(init.headers);
    } else if (typeof input === 'object' && input && typeof input.headers === 'object' && input.headers instanceof Headers) {
      headers = new Headers(input.headers);
    } else {
      headers = new Headers();
    }
    if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', token);
    init.headers = headers;
    return originalFetch.call(window, input, init);
  };
})();
