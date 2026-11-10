/* global self, caches, URL, Response, fetch, __SW_PRECACHE__ */
// Moto Infinite service worker. Built into dist/client/sw.js by scripts/vite-pwa.ts, which fills in
// the version and the precache list from the Vite bundle (app shell + every hashed asset).
//  - /assets/*  cache-first (file names are content-hashed, so a cached copy is always correct)
//  - pages      network-first, falling back to the cached shell (offline single-player)
//  - /api/*     never cached (rooms, logs)
//  - /.well-known/*  never touched (Android Digital Asset Links must always come from the network)
//  - other      stale-while-revalidate (icons, manifest, favicon)
const VERSION = '__SW_VERSION__';
const PRECACHE = __SW_PRECACHE__;
const SHELL = 'moto-shell-' + VERSION;
const RUNTIME = 'moto-runtime-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then(async (cache) => {
      // one by one so a single missing file can't block installation of the rest
      await Promise.all(PRECACHE.map(async (url) => {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) await cache.put(url, await clean(res));
        } catch {
          /* fetched again at runtime */
        }
      }));
    }),
  );
  // No skipWaiting here: the page shows "Update available" and asks us to switch (SKIP_WAITING).
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('moto-') && k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) return;
  if (req.mode === 'navigate') event.respondWith(networkFirst(req));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(req));
  else event.respondWith(staleWhileRevalidate(req, event));
});

/** Redirected responses can't be served for navigations: store a plain copy. */
async function clean(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put('/', await clean(res.clone()));
    return res;
  } catch {
    return (await cache.match('/')) || (await caches.match(req)) || new Response('<h1>Offline</h1><p>Moto Infinite has not been cached yet. Connect once and reload.</p>', { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const cache = await caches.open(RUNTIME);
    await cache.put(req, res.clone());
  }
  return res;
}

async function staleWhileRevalidate(req, event) {
  const hit = await caches.match(req, { ignoreSearch: true });
  const update = fetch(req).then(async (res) => {
    if (res.ok) await (await caches.open(RUNTIME)).put(req, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(update.catch(() => undefined));
    return hit;
  }
  return update;
}
