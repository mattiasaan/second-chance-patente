// Service worker: l'interfaccia si apre subito (anche offline),
// i dati arrivano sempre dal server.
const CACHE = 'second-chance-patente-v2';
const SHELL = ['/', '/style.css', '/app.js', '/dom.js', '/charts.js', '/stats.js', '/manifest.webmanifest',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/fonts/barlow-latin-400-normal.woff2', '/fonts/barlow-latin-500-normal.woff2',
  '/fonts/barlow-latin-600-normal.woff2', '/fonts/barlow-latin-700-normal.woff2',
  '/fonts/barlow-semi-condensed-latin-600-normal.woff2', '/fonts/barlow-semi-condensed-latin-700-normal.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;

  // stale-while-revalidate per l'interfaccia
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached || (req.mode === 'navigate' ? cache.match('/') : undefined));
      return cached || net;
    })
  );
});
