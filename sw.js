const CACHE_NAME = 'maister-treker-v23'; // NEW: чистка мертвого коду — прибрано осиротілі showAbonentHistory/findAbonentMatches/normalizeAddressKey (кнопку "Історія" вже прибирали раніше), невикористовуваний tryGps() (замінений на ручну вставку посилання), задвоєну функцію isoToDdmmyyyy (друге оголошення тихо перекривало перше — прибрано мертве) і невикористовувану syncShiftPost (POST-версію, витіснену syncShiftPostGet). Функціональних змін немає — лише прибирання коду, який ніде не викликається.
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './qrcode.js',
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

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
