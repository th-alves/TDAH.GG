// sw.js — TDAH.GG Riot Import
const CACHE_VERSION = 'tdahriot-v3';
const IMG_CACHE     = 'tdagriot-imgs-v2';

// Ao instalar, não pré-cacheia nada — evita servir versões antigas
self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  // Limpa todos os caches antigos na ativação
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

  // DDragon images: cache-first (imagens não mudam entre atualizações do site)
  if (url.hostname === 'ddragon.leagueoflegends.com' && url.pathname.includes('/img/')) {
    e.respondWith(
      caches.open(IMG_CACHE).then(c =>
        c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
          if (r.ok) c.put(e.request, r.clone());
          return r;
        }))
      )
    );
    return;
  }

  // HTML, JS, CSS: network-first — garante sempre a versão mais recente
  // Cache só é usado como fallback se a rede falhar (offline)
  e.respondWith(
    fetch(e.request)
      .then(r => {
        if (r.ok) {
          caches.open(CACHE_VERSION).then(c => c.put(e.request, r.clone()));
        }
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
