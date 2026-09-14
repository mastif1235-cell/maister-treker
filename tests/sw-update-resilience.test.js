'use strict';
/* Регресія аудиту (P1 оновлення PWA):
   1) install більше не «all-or-nothing»: одна 404-помилка будь-якого другорядного
      активу раніше зривала ВСЮ інсталяцію — браузер назавжди лишався на старому
      сервис-воркері, а користувач ніколи не діставав фікси. Тепер: повторна
      спроба addAll, потім поштучний добір; критичне ядро (shell/app.js/styles/
      manifest) — обов'язкове: без нього інсталяція чесно падає і старий
      повний кеш лишається в обігу.
   2) 'MT_SW_ACTIVATED' має живого споживача: app.js запам'ятовує активований
      кеш для діагностики й підсвічує банер оновлення зайнятому користувачу.
   3) Довгі сесії в полі: update() тепер не лише на load — є 6-годинний poll
      з годинним троттлом + перевірка при поверненні в активну вкладку. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const swSource=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const appSource=fs.readFileSync(path.join(root,'app.js'),'utf8');

// ---------- static ----------
assert.match(swSource,/const CRITICAL_CORE_ASSETS=\[[^\]]*'\.\/index\.html'[^\]]*'\.\/app\.js'[^\]]*'\.\/styles\.css'[^\]]*'\.\/manifest\.json'/,'critical core set is explicit');
assert.match(swSource,/function cacheCoreAssets\(cache\)\{[\s\S]*?cache\.addAll\(requests\)\.catch\(async[\s\S]*?await cache\.addAll\(requests\); return;/,'install retries addAll once before falling back');
assert.match(swSource,/for\(const asset of CRITICAL_CORE_ASSETS\)\{ await cache\.add\(/,'critical assets are demanded individually in the fallback');
assert.match(swSource,/for\(const asset of CORE_ASSETS\)\{[\s\S]*?try\{ await cache\.add\([\s\S]*?catch\(_assetError\)\{ misses\.push\(asset\);/,'non-critical assets degrade to a logged miss list');
assert.match(swSource,/await cacheCoreAssets\(cache\);\s*\n\s*await self\.skipWaiting\(\);/,'skipWaiting happens only after the complete shell is cached (fallback flow included)');
assert.match(swSource,/upgrade:stale\.length>0/,'activation message distinguishes upgrade from first install');

const swr=appSource.slice(appSource.indexOf("if('serviceWorker' in navigator)"));
assert.match(swr,/let serviceWorkerRegistration=null;/,'registration handle is kept for periodic checks');
assert.match(swr,/function serviceWorkerPollUpdate\(\)\{[\s\S]*?now-serviceWorkerLastUpdateCheck<60\*60\*1000[\s\S]*?serviceWorkerRegistration\.update\(\)/,'periodic update check is throttled to one network check per hour');
assert.match(swr,/setInterval\(serviceWorkerPollUpdate, 6\*60\*60\*1000\);/,'long field sessions poll for updates every six hours');
assert.match(swr,/document\.addEventListener\('visibilitychange',\(\)=>\{ if\(document\.visibilityState==='visible'\) serviceWorkerPollUpdate\(\); \}\);/,'returning to the app checks for updates');
assert.match(swr,/data\.type!=='MT_SW_ACTIVATED'\) return;[\s\S]*?mtActiveServiceWorkerCacheName=data\.cacheName\|\|null;[\s\S]*?if\(data\.upgrade&&!serviceWorkerRefreshing[\s\S]*?serviceWorkerShowUpdateOffer\(\);/,'the MT_SW_ACTIVATED message is consumed: busy users keep the update banner');

// ---------- runtime ----------
function createSwHarness({addAllAttempts=()=>Promise.resolve(), addImpl=null}={}){
  const handlers={},state={skipWaiting:0,added:[],addedIndividually:[],messages:[],deleted:[]};
  let addAllCalls=0;
  const cache={
    addAll:async requests=>{ addAllCalls++; const behavior=addAllAttempts(addAllCalls); if(behavior) await behavior; state.added.push(...requests.map(r=>r.url)); },
    add:async request=>{ if(addImpl) await addImpl(request); state.addedIndividually.push(request.url); },
    put:async()=>{}
  };
  const context={
    console:{log(){},warn(){},error(){}},
    Request:class{constructor(url,options){this.url=url;this.cache=options&&options.cache;}},
    Response:class{},
    fetch:()=>Promise.resolve({status:200,clone(){return this;}}),
    caches:{open:async()=>cache,keys:async()=>state.keys||[],delete:async k=>{state.deleted.push(k);return true;}},
    clients:{matchAll:async()=>[{postMessage:m=>state.messages.push(m)}],claim:async()=>{}},
    self:{location:{origin:'https://example.test'},addEventListener:(n,f)=>{handlers[n]=f;},skipWaiting:async()=>{state.skipWaiting++;}}
  };
  context.self.clients=context.clients;
  vm.createContext(context);
  vm.runInContext(swSource,context);
  state.addAllCalls=()=>addAllCalls;
  return {handlers,state,context};
}

async function fireInstall(harness){
  let promise;harness.handlers.install({waitUntil:p=>{promise=p;}});await promise;
}
async function fireActivate(harness){
  let promise;harness.handlers.activate({waitUntil:p=>{promise=p;}});await promise;
}

(async()=>{
  // 1) Щасливий шлях: один addAll, жодного поштучного добору.
  {
    const h=createSwHarness();
    await fireInstall(h);
    assert.ok(h.state.added.length>=100,'complete set is cached in one addAll');
    assert.equal(h.addAllCalls?h.addAllCalls():h.state.addAllCalls(),1,'happy path does not retry');
    assert.equal(h.state.addedIndividually.length,0);
    assert.equal(h.state.skipWaiting,1,'activation after complete cache');
  }
  // 2) Друга спроба рятує: один тимчасовий збій — install успішна.
  {
    let call=0;
    const h=createSwHarness({addAllAttempts:()=>{call++;return call===1?Promise.reject(new Error('network blip')):null;}});
    await fireInstall(h);
    assert.equal(h.state.skipWaiting,1,'second chance install completes');
    assert.equal(h.state.addedIndividually.length,0);
  }
  // 3) addAll падає двічі: поштучний добір, критичне — обов'язкове.
  {
    let call=0;
    const h=createSwHarness({addAllAttempts:()=>{call++;return Promise.reject(new Error('offline partial'));}});
    await fireInstall(h);
    assert.ok(h.state.addedIndividually.includes('./index.html')&&h.state.addedIndividually.includes('./app.js'),'critical assets are demanded individually');
    assert.ok(h.state.addedIndividually.length>=100,'the rest of the set is attempted too');
    assert.equal(h.state.skipWaiting,1,'fault-tolerant install still activates');
  }
  // 4) Немає критичного ядра — інсталяція чесно падає, старий воркер лишається.
  {
    const h=createSwHarness({
      addAllAttempts:()=>Promise.reject(new Error('deploy half-broken')),
      addImpl:request=>{ if(request.url==='./app.js') throw new Error('404'); }
    });
    let failed=false;
    try{ await fireInstall(h); }catch(_e){ failed=true; }
    assert.equal(failed,true,'broken critical core rejects installation');
    assert.equal(h.state.skipWaiting,0,'old service worker stays in control');
  }
  // 5) activate: при оновленні — старі кеші видалені, повідомлення несе upgrade:true;
  //    при першому встановленні — upgrade:false.
  {
    const h=createSwHarness();
    h.state.keys=['maister-treker-v65-runtime-64','unrelated'];
    await fireActivate(h);
    assert.equal(h.state.messages.length,1,'one MT_SW_ACTIVATED message');
    assert.equal(h.state.messages[0].type,'MT_SW_ACTIVATED');
    assert.equal(h.state.messages[0].upgrade,true,'stale app cache present — this is an upgrade');
    assert.deepEqual(h.state.deleted,['maister-treker-v65-runtime-64'],'only app-owned caches are removed');
    const fresh=createSwHarness();
    await fireActivate(fresh);
    assert.equal(fresh.state.messages[0].upgrade,false,'first install is not an upgrade');
  }
  console.log('PASS service-worker install is fault-tolerant, activation notices upgrade, updates poll in long sessions');
})().catch(error=>{process.exitCode=1;console.error(error);});
