// sw.js — TDAH.GG Riot Import
const CACHE = 'tdahriot-v1';
const STATIC = ['/', '/index.html', '/css/style.css', '/js/app.js', '/js/ddragon.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API calls: sempre network
  if (url.pathname.startsWith('/api/')) return;
  // DDragon images: cache-first
  if (url.hostname === 'ddragon.leagueoflegends.com' && url.pathname.includes('/img/')) {
    e.respondWith(
      caches.open('tdahriot-imgs').then(c =>
        c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
          if (r.ok) c.put(e.request, r.clone()); return r;
        }))
      )
    );
    return;
  }
  // Assets locais: cache-first
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
      if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
      return r;
    }))
  );
});
