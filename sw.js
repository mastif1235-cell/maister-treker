const CACHE_NAME = 'maister-treker-v25'; // NEW: критичний пункт аудиту — статус синхронізації з Google Таблицею тепер підтверджується по-справжньому: після "сліпого" no-cors запиту на додавання заявки йде окремий read-only GET-запит, що перевіряє, чи рядок дійсно з'явився в таблиці (потребує вставити оновлений код Apps Script і створити нову версію деплою — див. Налаштування). Якщо перевірка сама не вдалась (стара версія скрипта) — поведінка не змінюється, як і раніше. Основний запис-шлях (no-cors POST) не чіпали — він уже раз ламався при спробі "полагодити" CORS напряму.
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
