const CACHE_NAME = 'maister-treker-v64.3'; // Окремий кеш release v64.3.
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './qrcode.js',
  './js/core-utils.js',
  './js/phone-utils.js',
  './js/data-utils.js',
  './js/finance-utils.js',
  './js/shift-utils.js',
  './js/report-utils.js',
  './js/backup-storage.js',
  './js/ticket-storage.js',
  './js/photo-storage.js',
  './js/local-state-storage.js',
  './js/ticket-state-storage.js',
  './js/apps-script-reference.js',
  './js/settings-render.js',
  './js/calculator-render.js',
  './js/tickets-render.js',
  './js/address-render.js',
  './js/calendar-stats-render.js',
  './js/shift-render.js',
  './js/naryad-render.js',
  './js/settings-catalog-bindings.js',
  './js/settings-local-lists-bindings.js',
  './js/ticket-form-domain.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Запити до Google Apps Script (синхронізація) НЕ кешуємо —
  // вони завжди мають йти в мережу, щоб дані були актуальні.
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // Спочатку кеш (миттєво, незалежно від якості звʼязку), мережа —
  // лише у фоні, щоб оновити кеш до наступного запуску.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networkFetch = fetch(e.request).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || networkFetch;
    })
  );
});