/*
 * Service worker — static asset cache only.
 *
 * Deliberate policy:
 *  - HTML pages, /api responses, QR tokens, attendance and GPS data are NEVER
 *    cached. Attendance requires a live, verified server round-trip; there is
 *    no offline submission queue by design.
 *  - Only versioned static assets (css/js/vendor/icons) are pre-cached.
 *  - Navigations fall back to offline.html when the network is unreachable.
 */
const CACHE_NAME = 'att-static-v2';
const OFFLINE_URL = '/offline.html';

const PRECACHE = [
  OFFLINE_URL,
  '/js/offline.js',
  '/css/styles.css',
  '/js/csrf-helper.js',
  '/js/connection-status.js',
  '/js/api-helpers.js',
  '/vendor/bootstrap/js/bootstrap.bundle.min.js',
  '/vendor/bootstrap/css/bootstrap.min.css',
  '/vendor/bootstrap-icons/font/bootstrap-icons.min.css',
  '/vendor/bootstrap-icons/font/fonts/bootstrap-icons.woff2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/vendor/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/uploads/')
  );
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept non-GET requests, API calls, QR/attendance data or the
  // service worker itself.
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/service-worker.js') return;

  // Navigations: network-first, offline fallback.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Static assets: cache-first with network refresh (stale-while-revalidate).
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});

// Web push — show a simple notification. Payload contains title/message only;
// the server never includes GPS coordinates or other sensitive data.
self.addEventListener('push', (event) => {
  let payload = { title: 'School attendance', message: 'You have a new notification.' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    /* malformed payload: use defaults */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.message,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.eventId ? `event-${payload.eventId}` : undefined,
      data: { url: '/notifications' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/notifications';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
