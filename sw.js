const scope = self.registration.scope;
const prefix = `kvpia-${scope}-`;
// Change the version when publishing any change to the offline files.
const cacheName = `${prefix}v3`;
const shell = new URL('./index.html', scope).href;
const assets = new Set([
  './index.html', './app.js', './calculations.js', './guide.js', './styles.css',
  './manifest.webmanifest', './icons/apple-touch-icon.png', './icons/icon-192.png',
  './icons/icon-512.png', './icons/icon-maskable.png',
].map((path) => new URL(path, scope).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll([...assets].map((url) => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const oldCaches = (await caches.keys()).filter((key) => key.startsWith(prefix) && key !== cacheName);
    await Promise.all(oldCaches.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'activate-update') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  url.search = '';
  url.hash = '';
  const key = request.mode === 'navigate' && (url.href === scope || url.href === shell) ? shell : url.href;
  if (!assets.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(key)) ?? fetch(request);
  })());
});
