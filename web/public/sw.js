/*
 * sw.js — the offline shell and the instant second visit.
 *
 *  • Navigations: stale-while-revalidate. The cached document is returned at once and a fresh one is fetched
 *    behind it for the next visit (a cold load never waits on the network to start).
 *  • /assets/*: cache-first. Every file there is content-hashed, so a hit is always correct.
 *  • Everything else (API, audio, images, other origins): untouched — the server and the browser already cache
 *    those, and a service worker in the audio path only ever adds risk.
 *
 * __BUILD_ID__ is stamped in by the build; a new build means a new cache name and the old ones are deleted.
 */

const BUILD = '__BUILD_ID__';
const SHELL = `vy-shell-${BUILD}`;
const ASSETS = `vy-assets-${BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/')).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith('vy-') && n !== SHELL && n !== ASSETS).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const cached = await cache.match('/');
        const fresh = fetch('/', { cache: 'no-cache' }).then((res) => {
          if (res.ok) cache.put('/', res.clone());
          return res;
        });
        if (cached) {
          event.waitUntil(fresh.catch(() => {}));
          return cached;
        }
        return fresh;
      }),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
  }
});
