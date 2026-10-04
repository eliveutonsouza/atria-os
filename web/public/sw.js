// Service worker do Yui Console: app shell offline + notificações push.
// Nunca cacheia /api, /sandbox* nem streams (SSE/WebSocket) — dados sempre ao vivo.
const VERSION = '__BUILD__';
const SHELL = `yui-shell-${VERSION}`;
const PRECACHE = ['/', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/badge-96.png', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      let assets = [];
      try {
        assets = await (await fetch('/sw-assets.json', { cache: 'no-store' })).json();
      } catch {
        /* build sem lista: só o básico */
      }
      await cache.addAll([...PRECACHE, ...assets]);
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('yui-shell-') && k !== SHELL) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

const bypass = (url) =>
  url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/sandbox') || url.pathname === '/sw.js';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (bypass(url) || req.headers.get('accept')?.includes('text/event-stream')) return;

  // Navegação: rede primeiro (login/redirect continuam funcionando), shell em cache se offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(SHELL);
          return (await cache.match('/')) ?? (await cache.match('/offline.html'));
        }
      })(),
    );
    return;
  }
  // Assets com hash / ícones / fontes do Google: cache primeiro.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});

// ---------- push ----------
self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: 'Yui', body: event.data?.text() ?? '' };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || 'Yui', {
      body: d.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: d.tag || undefined,
      renotify: !!d.tag,
      requireInteraction: d.priority === 'high',
      data: { url: d.url || '/' },
      actions: d.actions || [],
      timestamp: Date.now(),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === location.origin) {
          await w.focus();
          w.postMessage({ type: 'yui.navigate', url: target });
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
