const CACHE_NAME = 'maister-treker-v54'; // NEW: сортування "за датою, найновіше зверху" у профілі абонента, пошуку по адресах/іменах і підстановці даних попереднього візиту тепер використовує справжню дату (числовий ключ), а не порівняння тексту "ДД.ММ.РРРР" — раніше через формат з днем на початку рядки сортувались здебільшого за днем місяця, а не хронологічно, тож при заявках за різні місяці порядок і підстановка логіна/пароля могли бути неправильними.
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
