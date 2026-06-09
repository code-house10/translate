const CACHE_NAME = 'jungle-movie-puter-ai-visible-v2';
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

  // Network-first for app shell so Vercel updates appear immediately.
  // This avoids seeing an old cached UI like "MyMemory Template Examples" after uploading a new version.
  if (url.origin === location.origin && ['document', 'script', 'style'].includes(req.destination)) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(() => null);
        return res;
      }).catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
    );
  }
});
