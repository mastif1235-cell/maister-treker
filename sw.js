const CACHE_NAME = 'maister-treker-v65-security-18-4'; // HMAC transport + delete-wins ordering + stale delete repair.
const CORE_ASSETS = [
  './','./index.html','./dogovor-secure.html','./d.html','./styles.css','./qrcode.js',
  './js/core-utils.js','./js/phone-utils.js','./js/data-utils.js','./js/finance-utils.js','./js/shift-utils.js','./js/report-utils.js',
  './js/backup-storage.js','./js/ticket-storage.js','./js/photo-storage.js','./js/local-state-storage.js','./js/ticket-state-storage.js',
  './js/apps-script-reference.js','./js/settings-render.js','./js/calculator-render.js','./js/tickets-render.js','./js/address-render.js','./js/calendar-stats-render.js','./js/shift-render.js','./js/naryad-render.js','./js/settings-catalog-bindings.js','./js/settings-local-lists-bindings.js','./js/ticket-form-domain.js',
  './js/security-hardening.js','./js/security-lock.js','./js/security-qr.js','./js/security-telegram.js','./js/security-backup-encryption.js','./js/security-backup-vault-hub.js','./js/security-backup-vault.js','./js/security-runtime-v65-9.js',
  './js/share-fix-v65-11.js','./js/share-photo-picker-v65-12.js','./js/share-multi-fix-v65-17-2.js','./js/telegram-backup-reliability-v65-13.js','./js/photo-data-fetch-v65-14.js','./js/security-backup-envelope-guard-v65-17.js','./js/security-dom-final-v65-18.js','./js/daily-physical-backup-v65-17-3.js','./js/security-sync-hmac-v65-18.js','./js/security-sync-verify-v65-18-1.js','./js/security-sync-race-v65-18-3.js','./js/security-sync-delete-repair-v65-18-4.js',
  './app.js','./manifest.json','./icon-192.png','./icon-512.png'
];

const SECURITY_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https://api.telegram.org https://script.google.com https://script.googleusercontent.com; font-src 'self' data:; media-src 'self' data: blob:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests";

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    await Promise.all(clients.map(async(client)=>{
      try{
        const url = new URL(client.url);
        if(url.origin === self.location.origin && typeof client.navigate === 'function') await client.navigate(client.url);
      }catch(e){}
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
    if(!/http-equiv=["']Content-Security-Policy["']/i.test(html) && html.includes('</head>')){
      const cspMeta = `  <meta http-equiv="Content-Security-Policy" content="${SECURITY_CSP.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}">\n`;
      html = html.replace('</head>', cspMeta + '</head>');
    }
    let scripts = '';
    const add = (src)=>{ if(!html.includes(src)) scripts += `  <script src="${src}"></script>\n`; };
    add('js/security-hardening.js');
    add('js/security-lock.js');
    add('js/security-qr.js');
    add('js/security-telegram.js');
    add('js/security-backup-encryption.js');
    add('js/security-backup-vault-hub.js');
    add('js/security-backup-vault.js');
    add('js/security-runtime-v65-9.js');
    add('js/share-fix-v65-11.js');
    add('js/share-photo-picker-v65-12.js');
    add('js/share-multi-fix-v65-17-2.js');
    add('js/telegram-backup-reliability-v65-13.js');
    add('js/photo-data-fetch-v65-14.js');
    add('js/security-backup-envelope-guard-v65-17.js');
    add('js/security-dom-final-v65-18.js');
    add('js/daily-physical-backup-v65-17-3.js');
    add('js/security-sync-hmac-v65-18.js');
    add('js/security-sync-verify-v65-18-1.js');
    add('js/security-sync-race-v65-18-3.js');
    add('js/security-sync-delete-repair-v65-18-4.js');
    if(scripts) html = html.replace('</body>', scripts + '</body>');
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('Content-Security-Policy', SECURITY_CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=()');
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  }catch(err){
    return response;
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
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
      }catch(e){}
      if(!chosen) chosen = await caches.match(e.request) || await caches.match('./index.html');
      return injectSecurityLayer(chosen);
    })());
    return;
  }
  e.respondWith(caches.match(e.request).then(async (cached) => {
    const networkFetch = fetch(e.request).then((res) => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache)=>cache.put(e.request, clone));
      }
      return res;
    }).catch(() => cached);
    return cached || await networkFetch;
  }));
});
