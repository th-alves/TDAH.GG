// sw.js — TDAH.GG Riot Import
const CACHE_VERSION = 'tdahriot-v4';
const IMG_CACHE     = 'tdagriot-imgs-v2';

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_VERSION && k !== IMG_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: sempre network, nunca cacheia
  if (url.pathname.startsWith('/api/')) return;

  // DDragon images: cache-first
  if (url.hostname === 'ddragon.leagueoflegends.com' && url.pathname.includes('/img/')) {
    e.respondWith(
      caches.open(IMG_CACHE).then(c =>
        c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
          if (r.ok) {
            const toCache = r.clone(); // clone sincrono antes de qualquer await
            c.put(e.request, toCache);
          }
          return r;
        }))
      )
    );
    return;
  }

  // HTML, JS, CSS: network-first
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          const toCache = r.clone(); // clone sincrono — body ainda não foi lido
          caches.open(CACHE_VERSION).then(c => c.put(e.request, toCache));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
