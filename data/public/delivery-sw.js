// Guru Kirpa Delivery Partner - Service Worker
const CACHE_NAME = 'gk-delivery-v1';
const ASSETS_TO_CACHE = [
  '/delivery',
  '/css/custom.css',
  '/js/delivery.js',
  '/assets/delivery-icon.svg',
  '/manifest-delivery.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.warn('Cache warm warning:', err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Allow API and SSE calls to go directly to network
  if (e.request.url.includes('/api/') || e.request.url.includes('/events')) {
    return;
  }
  
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
