const CACHE_NAME = 'maister-treker-v65-security-3'; // Security hardening preview.
const CORE_ASSETS = [
  './',
  './index.html',
  './dogovor-secure.html',
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
  './js/security-hardening.js',
  './js/security-lock.js',
  './js/security-qr.js',
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

async function injectSecurityLayer(response){
  if(!response) return response;
  try{
    const type = response.headers.get('content-type') || '';
    if(!type.includes('text/html')) return response;
    const html = await response.clone().text();
    if(!html.includes('</body>')) return response;

    let scripts = '';
    if(!html.includes('js/security-hardening.js')) scripts += '  <script src="js/security-hardening.js"></script>\n';
    if(!html.includes('js/security-lock.js')) scripts += '  <script src="js/security-lock.js"></script>\n';
    if(!html.includes('js/security-qr.js')) scripts += '  <script src="js/security-qr.js"></script>\n';
    if(!scripts) return response;

    const hardened = html.replace('</body>', scripts + '</body>');
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    return new Response(hardened, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }catch(err){
    return response;
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Запити до Google Apps Script (синхронізація) НЕ кешуємо —
  // вони завжди мають йти в мережу, щоб дані були актуальні.
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // Спочатку кеш (миттєво, незалежно від якості звʼязку), мережа —
  // лише у фоні, щоб оновити кеш до наступного запуску.
  e.respondWith(
    caches.match(e.request).then(async (cached) => {
      const networkFetch = fetch(e.request).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);

      const chosen = cached || await networkFetch;
      if(e.request.mode === 'navigate') return injectSecurityLayer(chosen);
      return chosen;
    })
  );
});
