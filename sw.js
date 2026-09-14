const CACHE_NAME = 'maister-treker-v67-runtime-66';
const CORE_ASSETS = [
  './','./index.html','./dogovor-secure.html','./d.html','./d.js','./dogovor-secure.js','./styles.css','./qrcode.js','./vendor/leaflet/leaflet.css','./vendor/leaflet/leaflet.js','./vendor/leaflet/images/layers.png','./vendor/leaflet/images/layers-2x.png','./vendor/leaflet/images/marker-icon.png','./vendor/leaflet/images/marker-icon-2x.png','./vendor/leaflet/images/marker-shadow.png','./vendor/maplibre/maplibre-gl.css','./vendor/maplibre/maplibre-gl.mjs','./vendor/maplibre/maplibre-gl-shared.mjs','./vendor/maplibre/maplibre-gl-worker.mjs','./vendor/maplibre/LICENSE.txt','./vendor/pmtiles/pmtiles.js','./vendor/pmtiles/LICENSE.txt',
  './js/core-utils.js','./js/safe-error.js','./js/storage-registry.js','./js/app-format-utils.js','./js/phone-utils.js','./js/data-utils.js','./js/map-marker-renderer.js','./js/address-suggestions.js','./js/ticket-time-utils.js','./js/settings-core.js','./js/finance-utils.js','./js/shift-utils.js','./js/report-utils.js',
  './js/backup-storage.js','./js/settings-secrets-vault.js','./js/ticket-storage.js','./js/photo-storage.js','./js/local-state-storage.js','./js/ticket-state-storage.js',
  './js/apps-script-reference.js','./js/settings-render.js','./js/calculator-render.js','./js/tickets-render.js','./js/address-render.js','./js/calendar-stats-render.js','./js/shift-render.js','./js/naryad-render.js','./js/settings-catalog-bindings.js','./js/settings-local-lists-bindings.js','./js/ticket-form-domain.js','./js/ticket-editor-core.js','./js/tools-core.js','./js/maptiler-local-config.js','./js/offline-map-storage.js','./js/tools-map-maplibre.js','./js/tools-map.js','./js/sync-contract.js','./js/sync-engine-core.js','./js/sync-journal-storage.js','./js/sync-transport.js','./js/sync-engine-runtime.js','./js/app-lock-core.js',
  './js/ui-orchestration.js','./js/storage-orchestration.js','./js/qr-share-domain.js','./js/share-domain.js','./js/reports-domain.js','./js/settings-domain.js','./js/photo-telegram-domain.js','./js/shifts-domain.js','./js/ticket-editor-domain.js','./js/ticket-editor-financial.js','./js/ticket-editor-photos.js','./js/tickets-domain.js','./js/tickets-bindings.js','./js/ticket-address-domain.js','./js/ticket-profile-editor.js','./js/tools-domain.js','./js/tools-network-points.js','./js/tools-offline-ui.js','./js/tools-diagnostics-ui.js','./js/tools-diagnostics-network.js','./js/security-hardening.js','./js/security-lock.js','./js/security-qr.js','./js/security-telegram.js','./js/security-runtime-v65-9.js',
  './js/single-writer-lock.js',
  './js/telegram-backup-reliability-v65-13.js','./js/photo-data-fetch-v65-14.js','./js/security-dom-final-v65-18.js','./js/backup-system.js','./js/restore-from-sheets.js','./js/security-audit-fixes-v65-18-9.js',
  './app.js','./manifest.json','./icon-192.png','./icon-512.png','./assets/logo-tab-sprite.png'
];

/* Критичне ядро: без нього застосунок не стартує офлайн узагалі. Якщо будь-
   який із цих файлів недоступний — інсталяція нового кешу МАЄ зірватися: тоді
   браузер лишиться на старому, повному й робочому наборі (best-effort кеш із
   дірками гірший за відсутність оновлення). Решту активів добираємо окремо. */
const CRITICAL_CORE_ASSETS=['./','./index.html','./app.js','./styles.css','./manifest.json'];

function cacheCoreAssets(cache){
  const requests=CORE_ASSETS.map((asset)=>new Request(asset,{cache:'reload'}));
  return cache.addAll(requests).catch(async(firstError)=>{
    // Друга спроба тим самим шляхом: ловить короткі мережеві збої.
    try{ await cache.addAll(requests); return; }
    catch(_retryError){
      // І все ще не вийшло: критичне — обов'язково; решту — що вдалося.
      for(const asset of CRITICAL_CORE_ASSETS){ await cache.add(new Request(asset,{cache:'reload'})); }
      const misses=[];
      for(const asset of CORE_ASSETS){
        if(CRITICAL_CORE_ASSETS.indexOf(asset)>=0) continue;
        try{ await cache.add(new Request(asset,{cache:'reload'})); }
        catch(_assetError){ misses.push(asset); }
      }
      if(misses.length) console.warn('Попереднє кешування пропущено (добереме фоном):',misses.join(', '));
      void firstError;
    }
  });
}

self.addEventListener('install', (e) => {
  e.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cacheCoreAssets(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async()=>{
    const keys = await caches.keys();
    const stale=keys.filter((k) => k.startsWith('maister-treker-') && k !== CACHE_NAME);
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    // upgrade:true — то було оновлення наявного встановлення, а не перший
    // запуск; сторінка використовує це для делікатної підказки перезавантаження.
    clients.forEach((client)=>client.postMessage({type:'MT_SW_ACTIVATED', cacheName:CACHE_NAME, upgrade:stale.length>0}));
  })());
});

/* ── Цілісність релізу (завершення аудиту P1) ─────────────────────────────────
   Активний CACHE_NAME — незмінний (immutable) набір. Фоновий fetch НЕ ПІДМІНЯЄ
   вже кешовані JS/CSS/HTML: пофайлова заміна створювала «франкенкеш» — свіжий
   app.js поруч зі старим tickets-domain.js усередині того самого кешу — і
   наступне завантаження збирало файли з різних релізів одразу. Тому:
     • є запис у кеші → віддаємо його, мережу для заміни не деремо взагалі;
     • запису немає («дірка» після збійного встановлення) → дістаємо з мережі й
       ДОДАЄМО у кеш — це латка, а не підміна; офлайн так і залишається робочим;
     • новий набір активується ЛИШЕ новою версією Service Worker з новим
       CACHE_NAME (install → activate), а старі кеші зникають атомарно в
       activate. Мішати версії всередині одного кешу фізично ніде. */
async function cacheShellGap(request,response){
  try{
    const cache=await caches.open(CACHE_NAME);
    if(await cache.match(request,{ignoreSearch:true}))return; // запис уже є — не чіпаємо
    await cache.put(request,response.clone());
  }catch(_putError){/* офлайн чи переповнене сховище — дірку латаємо наступного візиту */}
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
  if(e.request.mode === 'navigate'){
    e.respondWith((async()=>{
      const hit=await caches.match(e.request,{ignoreSearch:true})||await caches.match('./index.html');
      if(hit)return hit;
      const fresh=await fetch(e.request,{cache:'no-store'}).catch(()=>null);
      if(fresh&&fresh.status===200)await cacheShellGap(e.request,fresh);
      return fresh;
    })());
    return;
  }
  if(/\.(?:js|mjs|css)$/.test(url.pathname)){
    e.respondWith((async()=>{
      const hit=await caches.match(e.request,{ignoreSearch:true});
      if(hit)return hit;
      const fresh=await fetch(e.request,{cache:'no-store'}).catch(()=>null);
      if(fresh&&fresh.status===200)await cacheShellGap(e.request,fresh);
      return fresh;
    })());
    return;
  }
  e.respondWith((async()=>{
    const hit=await caches.match(e.request);
    if(hit)return hit;
    const fresh=await fetch(e.request).catch(()=>null);
    if(fresh&&fresh.status===200)await cacheShellGap(e.request,fresh);
    return fresh;
  })());
});
