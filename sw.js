const CACHE_NAME = 'maister-treker-v67-runtime-87';
const CORE_ASSETS = [
  './','./index.html','./dogovor-secure.html','./d.html','./d.js','./dogovor-secure.js','./styles.css','./qrcode.js','./vendor/leaflet/leaflet.css','./vendor/leaflet/leaflet.js','./vendor/leaflet/images/layers.png','./vendor/leaflet/images/layers-2x.png','./vendor/leaflet/images/marker-icon.png','./vendor/leaflet/images/marker-icon-2x.png','./vendor/leaflet/images/marker-shadow.png','./vendor/maplibre/maplibre-gl.css','./vendor/maplibre/maplibre-gl.mjs','./vendor/maplibre/maplibre-gl-shared.mjs','./vendor/maplibre/maplibre-gl-worker.mjs','./vendor/maplibre/LICENSE.txt','./vendor/pmtiles/pmtiles.js','./vendor/pmtiles/LICENSE.txt',
  './js/core-utils.js','./js/safe-error.js','./js/storage-registry.js','./js/app-format-utils.js','./js/phone-utils.js','./js/data-utils.js','./js/map-marker-renderer.js','./js/address-suggestions.js','./js/ticket-time-utils.js','./js/settings-core.js','./js/finance-utils.js','./js/shift-utils.js','./js/report-utils.js',
  './js/backup-storage.js','./js/settings-secrets-vault.js','./js/ticket-storage.js','./js/photo-storage.js','./js/telegram-full-snapshot.js','./js/local-state-storage.js','./js/ticket-state-storage.js',
  './js/apps-script-reference.js','./js/settings-render.js','./js/calculator-render.js','./js/tickets-render.js','./js/address-render.js','./js/calendar-stats-render.js','./js/shift-render.js','./js/naryad-render.js','./js/settings-catalog-bindings.js','./js/settings-local-lists-bindings.js','./js/ticket-form-domain.js','./js/ticket-editor-core.js','./js/tools-core.js','./js/maptiler-local-config.js','./js/offline-map-storage.js','./js/tools-map-maplibre.js','./js/tools-map.js','./js/sync-contract.js','./js/sync-engine-core.js','./js/sync-journal-storage.js','./js/sync-transport.js','./js/sync-engine-runtime.js','./js/app-lock-core.js',
  './js/ui-orchestration.js','./js/storage-orchestration.js','./js/sync-full-push.js','./js/qr-share-domain.js','./js/share-domain.js','./js/reports-domain.js','./js/settings-domain.js','./js/photo-telegram-domain.js','./js/shifts-domain.js','./js/ticket-editor-domain.js','./js/ticket-editor-financial.js','./js/ticket-editor-photos.js','./js/tickets-domain.js','./js/tickets-bindings.js','./js/ticket-address-domain.js','./js/ticket-profile-editor.js','./js/tools-domain.js','./js/tools-network-points.js','./js/tools-offline-ui.js','./js/tools-diagnostics-ui.js','./js/tools-diagnostics-network.js','./js/security-hardening.js','./js/security-lock.js','./js/security-qr.js','./js/security-telegram.js','./js/security-runtime-v65-9.js',
  './js/single-writer-lock.js',
  './js/telegram-backup-reliability-v65-13.js','./js/security-dom-final-v65-18.js','./js/backup-system.js','./js/restore-from-sheets.js','./js/security-audit-fixes-v65-18-9.js','./js/pricing/pricing-storage.js','./js/pricing/pricing-service.js','./js/pricing/pricing-ui.js','./js/ai/ai-config.js','./js/ai/providers/provider-registry.js','./js/ai/providers/groq.js','./js/ai/providers/deepseek.js','./js/ai/ai-provider.js','./js/ai/ai-storage.js','./js/ai/ai-client.js','./js/ai/ai-render.js','./js/ai/ai-result-cards.js','./js/ai/ai-attachments.js','./js/ai/ai-voice.js','./js/ai/actions/ai-actions.js','./js/ai/actions/ticket-actions.js','./js/ai/actions/photo-actions.js','./js/ai/ai-chat.js','./js/ai/ai-ui.js','./js/ai/ai-help.js','./js/ai/ai-settings.js',
  './app.js','./manifest.json','./icon-192.png','./icon-512.png','./assets/logo-tab-sprite.png'
];

/* Мінімум, без якого неможливо навіть ПРОВЕСТИ перевірку повноти (нижче):
   якщо ці файли не прекешувалися, index.html не зчитати зі свіжого кешу.
   Повний же набір «без чого index.html не здатен запустити застосунок
   офлайн» виводиться автоматично з самого index.html — div MT_BOOT_RUNTIME.
   Якщо будь-який із цих файлів недоступний — інсталяція нового кешу МАЄ
   зірватися: тоді браузер лишиться на старому, повному й робочому наборі
   (best-effort кеш із дірками гірший за відсутність оновлення). Решту
   активів добираємо окремо. */
const CRITICAL_CORE_ASSETS=['./','./index.html','./app.js','./styles.css','./manifest.json'];

/* ── Атомарний boot runtime (fix v91.30, HIGH) ───────────────────────────────
   Єдине джерело істини про обов'язкові boot-файли — сам index.html у НОВОМУ
   кеші: усі його <script src> + <link rel="stylesheet"> (плюс корінь і
   manifest). Список фізично не може розсинхронізуватись: новий script у
   index.html автоматично стає обов'язковим для активації, жоден ручний
   список у SW не треба пам'ятати. Ліниві (runtime) активи — qrcode.js,
   vendor/leaflet/*, vendor/maplibre/*, js/tools-map-maplibre.js тощо —
   index.html синхронно не завантажує, тому їхня відсутність НЕ блокує boot:
   застосунок здатен завантажитись без них, а дірка лататиметься фоном. */
function mtNormalizeBootAsset(url){
  // Зовнішні (CDN/протокольні) URL не прекешируються і не можуть бути у кеші —
  // вони не роблять install неатомарним і перевірку не блокують.
  if(/^(?:[a-z][a-z0-9+.\-]*:)?\/\//i.test(url))return null;
  if(url.startsWith('/'))return url; // кореневий шлях того ж origin
  return url.startsWith('./')?url:'./'+url;
}
function mtBootAssetsFromIndex(html){
  const assets=new Set(['./','./index.html','./manifest.json']);
  for(const match of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)){
    const asset=mtNormalizeBootAsset(match[1]||match[2]||match[3]);
    if(asset)assets.add(asset);
  }
  for(const tag of html.matchAll(/<link\b[^>]*>/gi)){
    if(!/\brel\s*=\s*(?:"[^"]*stylesheet[^"]*"|'[^']*stylesheet[^']*'|[^"'>\s]*stylesheet)/i.test(tag[0]))continue;
    const href=tag[0].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    const asset=href&&mtNormalizeBootAsset(href[1]||href[2]||href[3]);
    if(asset)assets.add(asset);
  }
  return [...assets];
}
async function mtAssertBootRuntimeComplete(cache){
  const pageResponse=await cache.match('./index.html',{ignoreSearch:true});
  if(!pageResponse)throw new Error('MT_BOOT_RUNTIME_INCOMPLETE: ./index.html');
  const html=await pageResponse.text();
  const missing=[];
  for(const asset of mtBootAssetsFromIndex(html)){
    try{ if(!await cache.match(asset,{ignoreSearch:true}))missing.push(asset); }
    catch(_matchError){ missing.push(asset); }
  }
  if(missing.length)throw new Error('MT_BOOT_RUNTIME_INCOMPLETE: '+missing.join(', '));
}

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
    try{
      await cacheCoreAssets(cache);
      // Атомарність активації: skipWaiting() лише після ДОКАЗАНОЇ повноти
      // обов'язкового boot runtime у НОВОМУ кеші. Хоч один відсутній
      // обов'язковий файл → install провалюється: новий SW не стає активним,
      // старий повний кеш не чіпається, поточна версія працює офлайн далі.
      await mtAssertBootRuntimeComplete(cache);
    }catch(bootError){
      // Недобудований кеш прибираємо: глобальний caches.match не зможе
      // змішати його файли з активними, і сміття не накопичується.
      // Старий активний кеш (інший CACHE_NAME) це не торкається.
      await caches.delete(CACHE_NAME).catch(()=>{});
      throw bootError;
    }
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
