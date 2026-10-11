// Caches the app's files so it opens and works offline.
// Always asks the network first, so a newly published version shows up right away;
// the cached copy is only used when there's no connection.
const CACHE = 'weight-tracker-v5';
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
  // One cached copy per file: Siri links (?w=72.4) would otherwise each add another copy of the page.
  const key = new URL(req.url);
  key.search = '';
  e.respondWith(
    // no-cache revalidates with the server instead of trusting the browser's HTTP cache.
    fetch(req.url, { cache: 'no-cache' })
      .then(async (res) => {
        if (res.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(key.href, res.clone());
        }
        return res;
      })
      .catch(() => caches.match(key.href).then((hit) => hit || Response.error()))
  );
});
