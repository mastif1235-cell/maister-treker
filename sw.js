const CACHE_NAME = 'maister-treker-v65-security-10-r2'; // Security hardening + update reliability.
const CORE_ASSETS = [
  './',
  './index.html',
  './dogovor-secure.html',
  './d.html',
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
  './js/security-telegram.js',
  './js/security-backup-encryption.js',
  './js/security-backup-vault-hub.js',
  './js/security-backup-vault.js',
  './js/security-runtime-v65-9.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const SECURITY_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.telegram.org https://script.google.com https://script.googleusercontent.com; font-src 'self' data:; media-src 'self' data: blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests";

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();

    // A newly activated worker means application code has changed. Existing
    // PWA windows keep executing the old JavaScript until a navigation occurs,
    // which previously left the version label one release behind. Refresh each
    // same-origin window once at activation so the new cache/runtime is used
    // immediately. This runs only once per worker activation, so no reload loop.
    const clients = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    await Promise.all(clients.map(async(client)=>{
      try{
        const url = new URL(client.url);
        if(url.origin === self.location.origin && typeof client.navigate === 'function'){
          await client.navigate(client.url);
        }
      }catch(e){ /* some embedded webviews may not allow navigate() */ }
    }));
  })());
});

async function injectSecurityLayer(response){
  if(!response) return response;
  try{
    const type = response.headers.get('content-type') || '';
    if(!type.includes('text/html')) return response;
    let html = await response.clone().text();
    if(!html.includes('</body>')) return response;

    // GitHub Pages ignores Netlify-style _headers files. For navigations that
    // are already controlled by this service worker, inject CSP into the HTML
    // before parsing so the policy applies to the whole document.
    if(!/http-equiv=["']Content-Security-Policy["']/i.test(html) && html.includes('</head>')){
      const cspMeta = `  <meta http-equiv="Content-Security-Policy" content="${SECURITY_CSP.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">\n`;
      html = html.replace('</head>', cspMeta + '</head>');
    }

    let scripts = '';
    if(!html.includes('js/security-hardening.js')) scripts += '  <script src="js/security-hardening.js"></script>\n';
    if(!html.includes('js/security-lock.js')) scripts += '  <script src="js/security-lock.js"></script>\n';
    if(!html.includes('js/security-qr.js')) scripts += '  <script src="js/security-qr.js"></script>\n';
    if(!html.includes('js/security-telegram.js')) scripts += '  <script src="js/security-telegram.js"></script>\n';
    if(!html.includes('js/security-backup-encryption.js')) scripts += '  <script src="js/security-backup-encryption.js"></script>\n';
    if(!html.includes('js/security-backup-vault-hub.js')) scripts += '  <script src="js/security-backup-vault-hub.js"></script>\n';
    if(!html.includes('js/security-backup-vault.js')) scripts += '  <script src="js/security-backup-vault.js"></script>\n';
    if(!html.includes('js/security-runtime-v65-9.js')) scripts += '  <script src="js/security-runtime-v65-9.js"></script>\n';
    if(scripts) html = html.replace('</body>', scripts + '</body>');

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('Content-Security-Policy', SECURITY_CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    return new Response(html, {
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

  // HTML/navigation: network-first when online, cache fallback offline. This
  // prevents an old cached index from hiding a freshly deployed release.
  if(e.request.mode === 'navigate'){
    e.respondWith((async()=>{
      let chosen = null;
      try{
        const fresh = await fetch(e.request, {cache:'no-store'});
        if(fresh && fresh.status === 200){
          chosen = fresh;
          const clone = fresh.clone();
          caches.open(CACHE_NAME).then((cache)=>cache.put(e.request, clone));
        }
      }catch(e){ /* offline: fallback below */ }
      if(!chosen) chosen = await caches.match(e.request) || await caches.match('./index.html');
      return injectSecurityLayer(chosen);
    })());
    return;
  }

  // Static assets stay cache-first for speed/offline use; network refreshes the
  // cache in the background for the next load.
  e.respondWith(
    caches.match(e.request).then(async (cached) => {
      const networkFetch = fetch(e.request).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);

      return cached || await networkFetch;
    })
  );
});
