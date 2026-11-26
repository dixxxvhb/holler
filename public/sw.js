// Holler service worker: app-shell cache that never goes stale for long, plus web push.
const CACHE = 'holler-shell-v1';

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  if (url.origin !== self.location.origin) return;
  const dest = req.destination;
  const shell = req.mode === 'navigate' || ['script', 'style', 'font', 'image', 'manifest', 'worker'].includes(dest)
    || /\.(?:js|css|html|webmanifest|svg|png|woff2?)$/.test(url.pathname);
  if (!shell) return;
  // Network first so a new deploy shows up on the next load; cache only answers when offline.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = (await cache.match(req)) || (req.mode === 'navigate' ? await cache.match(new URL('./', self.location).href) || await cache.match(new URL('./index.html', self.location).href) : null);
      if (hit) return hit;
      throw err;
    }
  })());
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const chat = d.chat || '';
  e.waitUntil(self.registration.showNotification(d.title || 'Holler', {
    body: d.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: chat || 'holler',
    renotify: true,
    data: { chat, url: d.url || (chat ? '#/c/' + chat : '') },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const hash = data.chat ? '#/c/' + data.chat : (data.url || '');
  e.waitUntil((async () => {
    const base = new URL('./', self.location).href;
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = all.find((c) => c.url.startsWith(base));
    if (mine) {
      try { await mine.focus(); } catch {}
      // switch chats inside the running app: a reload would make iPhones ask for the camera again
      mine.postMessage({ type: 'holler-open', hash });
      return;
    }
    await self.clients.openWindow(base + hash);
  })());
});
