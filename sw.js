const CACHE_NAME = 'jungle-movie-mymemory-template-examples-v3-delete-templates';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // App-shell only. Video caching is handled by IndexedDB inside the app
  // because normal Service Worker cache is not reliable for cross-origin range video requests.
  if (url.origin === location.origin && ['document', 'script', 'style'].includes(req.destination)) {
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(() => null);
        return res;
      }).catch(() => caches.match('./index.html')))
    );
  }
});
