const CACHE_NAME = 'maister-treker-v40'; // NEW: 1) виправлено регрес швидкості збереження — перевірка checkTicketExists раніше блокувала повернення до списку заявок (POST + окремий GET послідовно), на слабкому інтернеті розтягуючи збереження до 30+ секунд; тепер повертає результат одразу після POST, а перевірка йде у фоні з таймаутом 15с і заднім числом виправляє статус, якщо запис не підтвердився. 2) До 3 фото на заявку замість одного — вибір з камери АБО галереї (прибрано capture=environment, додано multiple), кожне окремо видаляється, у картці заявки розгортаються всі одразу з можливістю відкрити на весь екран, "Поділитись фото" надсилає всі разом. Старі заявки з одним фото читаються без міграції (photos будується з photo на льоту).
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

  // NEW: спочатку кеш (миттєво, незалежно від якості звʼязку), мережа —
  // лише у фоні, щоб оновити кеш до наступного запуску. Раніше було
  // навпаки (мережа спочатку, кеш — лише як fallback після невдачі). Це
  // добре працює, коли зв'язку нема ВЗАГАЛІ (fetch падає одразу), але
  // погано — коли сигнал є, та по факту не працює (глухе село, слабкий
  // 3G): fetch() тоді не падає одразу, а довго висить в очікуванні
  // таймауту, перш ніж зрештою впасти й узяти кеш. Через це застосунок
  // міг не відкриватись хвилинами саме там, де інтернет "начебто є" —
  // хоча в кеші вже лежить усе потрібне для миттєвого запуску.
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
