// SML service worker
// ──────────────────
// Strategy
//   • HTML (index.html, /)                              → network-first  ← critical for fresh UI
//   • JS / CSS / static assets                          → stale-while-revalidate
//   • API requests (/api/...)                           → network-first w/ cache fallback
//   • Audio streams (/api/recordings/<id>/stream)       → cache-first (immutable per-id URL)
//   • Anything else (fonts, CDN)                        → network-first
//
// Bump CACHE_VERSION whenever you ship a breaking change so old SW gets evicted.

const CACHE_VERSION = 'sml-v212-2026-06-02';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const AUDIO_CACHE   = `${CACHE_VERSION}-audio`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.webmanifest',
  '/icon.svg',
];

self.addEventListener('install', e => {
  // Don't fail install if some asset 404s — just precache what we can.
  e.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await Promise.allSettled(PRECACHE_URLS.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // Delete any cache that doesn't match the current version
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => !k.startsWith(CACHE_VERSION))
      .map(k => caches.delete(k)));
    await self.clients.claim();
    // ส่ง message ไปทุก client ที่ active เพื่อ trigger reload ได้ทันทีที่ SW ใหม่ active
    // (กัน case ที่ผู้ใช้เปิดหน้าเดิมค้างจาก SW เก่า → role visibility ไม่ apply)
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
    }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // Only handle same-origin GET — leave POST/PUT/DELETE + cross-origin alone
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // SSE stream — never cache (long-running, push-only)
  if (url.pathname === '/api/events') return;

  // Embed-mode iframe URLs — bypass SW entirely. We always want a fresh HTML
  // shell so any change to the inline embed CSS / script applies immediately.
  if (url.searchParams.has('embed')) return;

  // Audio stream — cache-first (URL changes on re-upload so it's safe to keep)
  if (url.pathname.startsWith('/api/recordings/') && url.pathname.endsWith('/stream')) {
    e.respondWith(cacheFirst(req, AUDIO_CACHE));
    return;
  }

  // API — network-first, fall back to cache (offline browse)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // HTML shell → network-first → ผู้ใช้ได้ UI ใหม่ทันที (กัน .hidden flag, role logic, etc. ค้าง cache)
  //   - request.mode === 'navigate' จะตรงทั้ง / และ /index.html ที่ browser นำทาง
  //   - /index.html ที่ fetch ตรง ๆ ก็จับด้วย pathname check
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(networkFirst(req, STATIC_CACHE));
    return;
  }

  // Static assets (JS/CSS/icons/etc.) — stale-while-revalidate so updates land on next reload
  e.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return cached || new Response('offline', { status: 503 });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline', offline: true }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}
