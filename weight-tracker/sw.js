// Caches the app's files so it opens and works offline.
// Serves from the cache first, then refreshes the cache in the background,
// so an updated version shows up on the next launch.
const CACHE = 'weight-tracker-v1';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icon.svg',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const cached = caches.match(req, { ignoreSearch: true });
  const network = fetch(req).then(async (res) => {
    if (res.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(req, res.clone());
    }
    return res;
  });
  e.waitUntil(network.catch(() => {}));
  e.respondWith(cached.then((hit) => hit || network));
});
