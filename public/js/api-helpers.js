(function () {
  'use strict';

  /**
   * Small fetch wrapper. Adds CSRF (via csrf-helper) and unwraps JSON errors.
   */
  window.api = async function api(url, options) {
    options = options || {};
    var init = {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: options.headers || {},
    };
    if (options.formData) {
      init.method = options.method || 'POST';
      init.body = options.formData;
    } else if (options.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }
    var res = await fetch(url, init);
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* non-JSON response */
    }
    if (!res.ok) {
      var err = new Error((data && data.error) || 'Request failed (' + res.status + ')');
      err.status = res.status;
      err.details = data && data.details;
      throw err;
    }
    return data;
  };

  window.showToast = function showToast(message, type) {
    var container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container position-fixed bottom-0 start-50 translate-middle-x p-3';
      container.style.zIndex = '3000';
      document.body.appendChild(container);
    }
    var el = document.createElement('div');
    el.className = 'toast align-items-center text-bg-' + (type || 'primary');
    el.setAttribute('role', 'alert');
    var row = document.createElement('div');
    row.className = 'd-flex';
    var body = document.createElement('div');
    body.className = 'toast-body';
    body.textContent = String(message == null ? '' : message);
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close btn-close-white me-2 m-auto';
    close.setAttribute('data-bs-dismiss', 'toast');
    close.setAttribute('aria-label', 'Close');
    row.appendChild(body);
    row.appendChild(close);
    el.appendChild(row);
    container.appendChild(el);
    var toast = new bootstrap.Toast(el, { delay: 4000 });
    toast.show();
    el.addEventListener('hidden.bs.toast', function () { el.remove(); });
  };

  window.confirmDialog = async function confirmDialog(message) {
    return window.confirm(message);
  };
})();
