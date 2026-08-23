const CACHE_NAME = 'maister-treker-v66-runtime-2';
const CORE_ASSETS = [
  './','./index.html','./dogovor-secure.html','./d.html','./d.js','./dogovor-secure.js','./styles.css','./qrcode.js',
  './js/core-utils.js','./js/app-format-utils.js','./js/phone-utils.js','./js/data-utils.js','./js/settings-core.js','./js/finance-utils.js','./js/shift-utils.js','./js/report-utils.js',
  './js/backup-storage.js','./js/ticket-storage.js','./js/photo-storage.js','./js/local-state-storage.js','./js/ticket-state-storage.js',
  './js/apps-script-reference.js','./js/settings-render.js','./js/calculator-render.js','./js/tickets-render.js','./js/address-render.js','./js/calendar-stats-render.js','./js/shift-render.js','./js/naryad-render.js','./js/settings-catalog-bindings.js','./js/settings-local-lists-bindings.js','./js/ticket-form-domain.js','./js/sync-contract.js','./js/sync-engine-core.js','./js/sync-journal-storage.js','./js/sync-transport.js','./js/sync-engine-runtime.js','./js/app-lock-core.js',
  './js/qr-share-domain.js','./js/share-domain.js','./js/reports-domain.js','./js/settings-domain.js','./js/security-hardening.js','./js/security-lock.js','./js/security-qr.js','./js/security-telegram.js','./js/security-runtime-v65-9.js',
  './js/share-fix-v65-11.js','./js/share-photo-picker-v65-12.js','./js/share-multi-fix-v65-17-2.js','./js/telegram-backup-reliability-v65-13.js','./js/photo-data-fetch-v65-14.js','./js/security-dom-final-v65-18.js','./js/backup-system.js','./js/security-audit-fixes-v65-18-9.js',
  './app.js','./manifest.json','./icon-192.png','./icon-512.png'
];

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
    clients.forEach((client)=>client.postMessage({type:'MT_SW_ACTIVATED', cacheName:CACHE_NAME}));
  })());
});

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
      return chosen;
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
