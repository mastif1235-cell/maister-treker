'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'sw.js'),'utf8'),appSource=fs.readFileSync(path.join(root,'app.js'),'utf8'),handlers={},deleted=[],added=[],puts=[];let localTouches=0,idbTouches=0,networkResolve,fetchCalls=0,skipWaitingCalls=0,reloadCalls=0,messageHandler;
assert.match(source,/CACHE_NAME\s*=\s*'maister-treker-v67-runtime-79'/,'installed-PWA cache revision is unique for the v91.34 full-snapshot restore release');
assert.match(appSource,/APP_VERSION\s*=\s*'v91\.34 · 2026-09-16'/,'canonical release identity is v91.34');
assert.match(appSource,/register\('sw\.js',\{updateViaCache:'none'\}\)/,'browser cache cannot suppress the service-worker update check');
assert.match(appSource,/function serviceWorkerUpdateIsSafe\(\)[\s\S]*hasUnsavedChanges\(\)[\s\S]*modalRoot[\s\S]*toolsSpeedController[\s\S]*isPointPlacementActive/,'update is deferred while a form, modal, speed test or map placement is active');
assert.match(appSource,/function serviceWorkerApplyUpdate\(\)[\s\S]*if\(serviceWorkerRefreshing\) return false;[\s\S]*saveDraftToLocalStorage\(\)[\s\S]*window\.location\.reload\(\)/,'reload stays single-shot and still saves the draft');
assert.match(appSource,/Доступне оновлення застосунку/,'an update offer is shown instead of a sudden reload');
assert.match(appSource,/appUpdateApplyBtn[\s\S]*appUpdateLaterBtn/,'the offer has explicit update and later actions');
assert.match(appSource,/serviceWorkerUpdateIsSafe\(\)\)\{ serviceWorkerApplyUpdate\(\); return; \}[\s\S]*serviceWorkerShowUpdateOffer\(\)/,'idle state updates immediately, busy state only offers');
assert.doesNotMatch(fs.readFileSync(path.join(root,'js','security-audit-fixes-v65-18-9.js'),'utf8'),/SECURITY_AUDIT_RELEASE_LABEL/);
const cachedNavigation={kind:'cached-navigation',text:async()=>''},cachedScript={kind:'cached-script',text:async()=>''};
const cache={addAll:async assets=>added.push(...assets),put:async(request,response)=>puts.push([request,response]),match:async request=>caches.match(request)};
const caches={open:async()=>cache,keys:async()=>['maister-treker-v66-runtime-42','unrelated-cache'],delete:async key=>{deleted.push(key);return true;},match:async request=>{const value=String(request?.url||request);if(value.includes('app.js'))return cachedScript;if(value.includes('index.html')||value.endsWith('/')||value.includes('manifest.json'))return cachedNavigation;return null;}};
const context={URL,Request:class Request{constructor(url,options){this.url=url;this.cache=options&&options.cache;}},fetch:()=>{fetchCalls++;return new Promise(resolve=>{networkResolve=resolve;});},caches,clients:{matchAll:async()=>[],claim:async()=>{}},self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting:async()=>{skipWaitingCalls++;}},localStorage:new Proxy({},{get(){localTouches++;}}),indexedDB:new Proxy({},{get(){idbTouches++;}})};context.self.clients=context.clients;vm.createContext(context);vm.runInContext(source,context);
async function fire(name){let promise;handlers[name]({waitUntil:p=>{promise=p;}});await promise;}
async function fetchEvent(request){let response;const waits=[];handlers.fetch({request,respondWith:p=>{response=p;},waitUntil:p=>waits.push(p)});return{value:await Promise.race([response,new Promise((_,reject)=>setTimeout(()=>reject(new Error('cached startup waited for network')),50))]),waits};}
async function networkedEvent(request,respond){let response;handlers.fetch({request,respondWith:p=>{response=p;},waitUntil:()=>{}});for(let i=0;i<10&&!networkResolve;i++)await Promise.resolve();respond(v=>{networkResolve(v);});return await response;}
(async()=>{
  await fire('install');await fire('activate');
  assert.ok(added.some(item=>item.url==='./index.html'&&item.cache==='reload'));assert.equal(skipWaitingCalls,1,'activation is requested only after the complete shell is cached');assert.ok(deleted.includes('maister-treker-v66-runtime-42'));assert.equal(deleted.includes('unrelated-cache'),false,'activation only removes app-owned caches');
  const navigation=await fetchEvent({url:'https://example.test/index.html?v=91.6',mode:'navigate',method:'GET'});
  assert.equal(navigation.value,cachedNavigation,'cached navigation is served instantly');
  assert.equal(navigation.waits.length,0,'and no background replacement work is scheduled');
  const script=await fetchEvent({url:'https://example.test/app.js?v=91.6',mode:'same-origin',method:'GET'});
  assert.equal(script.value,cachedScript,'cached core JS is served instantly');
  assert.equal(script.waits.length,0,'and no background replacement work is scheduled');
  assert.equal(fetchCalls,0,'kешовані shell-файли НЕ деруть мережу задля підміни — реліз усередині кешу незмінний');
  assert.equal(puts.length,0,'active cache never gets file-by-file refreshes that could mix release versions');
  // Дірка після збійного install: активного запису немає — перший візит дістає
  // файл із мережі й ДОДАЄ його до кешу (латка, не підміна).
  const gap=await networkedEvent({url:'https://example.test/js/late-audio.js',mode:'same-origin',method:'GET'},send=>send({status:200,clone(){return this;}}));
  assert.equal(gap.kind,undefined,'missing asset is served from network');
  assert.equal(puts.length,1,'the gap is filled in the active cache exactly once');
  assert.match(String(puts[0][0].url||puts[0][0]),/late-audio\.js$/,'gap fill writes only the previously missing file');
  assert.equal(puts[0][0].url,'https://example.test/js/late-audio.js');
  assert.equal(localTouches,0);assert.equal(idbTouches,0);assert.equal(/Clear-Site-Data|indexedDB|localStorage|deleteDatabase|opfs/i.test(source),false);assert.equal(/Clear-Site-Data|deleteDatabase/.test(appSource),false);
  // Клієнтська частина: оновлення не має виривати користувача з роботи.
  function clientHarness(state){
    state=state||{};
    const handlers={},reloads={count:0},elements={
      modalRoot:{children:state.modalOpen?[{}]:[]},
      appUpdateRoot:{innerHTML:''},
      appUpdateApplyBtn:{},
      appUpdateLaterBtn:{}
    };
    const context={
      navigator:{serviceWorker:{addEventListener:(name,fn)=>{handlers[name]=fn;},register:async()=>({update:async()=>{}})}},
      window:{addEventListener(){},location:{reload:()=>{reloads.count++;}}},
      document:{addEventListener(){},getElementById:id=>elements[id]||null},
      saveDraftToLocalStorage(){context.draftSaves=(context.draftSaves||0)+1;},
      hasUnsavedChanges:()=>!!state.unsaved,
      toolsSpeedController:state.speedTest?{abort(){}}:null,
      MTToolsMap:state.mapPlacement?{isPointPlacementActive:()=>true}:{isPointPlacementActive:()=>false},
      console
    };
    vm.createContext(context);
    vm.runInContext(appSource.slice(appSource.indexOf("if('serviceWorker' in navigator)"),appSource.indexOf("window.addEventListener('beforeunload'")),context);
    return {handlers,reloads,elements,context};
  }

  const idle=clientHarness({});
  idle.handlers.controllerchange();idle.handlers.controllerchange();
  assert.equal(idle.reloads.count,1,'idle controller activation causes at most one reload');
  assert.equal(idle.context.draftSaves,1,'draft is still saved once before the reload');
  assert.equal(typeof idle.handlers.message,'function','MT_SW_ACTIVATED has a live consumer (no longer a dead postMessage)');
  const idleReloads=idle.reloads.count;
  idle.handlers.message({data:{type:'MT_SW_ACTIVATED',cacheName:'maister-treker-x',upgrade:true}});
  idle.handlers.message({data:{type:'MT_SW_ACTIVATED',cacheName:'maister-treker-x',upgrade:true}});
  assert.equal(idle.reloads.count,idleReloads,'repeated MT_SW_ACTIVATED messages cannot trigger reloads');

  for(const busyState of [{unsaved:true},{modalOpen:true},{speedTest:true},{mapPlacement:true}]){
    const busy=clientHarness(busyState);
    busy.handlers.controllerchange();
    busy.handlers.controllerchange();
    assert.equal(busy.reloads.count,0,'busy state never reloads the app: '+JSON.stringify(busyState));
    assert.match(busy.elements.appUpdateRoot.innerHTML,/Доступне оновлення застосунку/,'update offer appears instead');
    assert.match(busy.elements.appUpdateRoot.innerHTML,/appUpdateApplyBtn/);
    assert.match(busy.elements.appUpdateRoot.innerHTML,/appUpdateLaterBtn/);
    assert.equal(busy.context.draftSaves,2,'draft is saved on every controller change even when the reload waits');
    assert.equal(typeof busy.elements.appUpdateLaterBtn.onclick,'function','later button is wired');
    busy.elements.appUpdateLaterBtn.onclick();
    assert.equal(busy.elements.appUpdateRoot.innerHTML,'','later dismisses the offer');
    assert.equal(busy.reloads.count,0,'dismissing never reloads');
    assert.equal(typeof busy.elements.appUpdateApplyBtn.onclick,'function','update button is wired');
    busy.elements.appUpdateApplyBtn.onclick();
    assert.equal(busy.reloads.count,1,'explicit user action reloads once');
    busy.elements.appUpdateApplyBtn.onclick();
    assert.equal(busy.reloads.count,1,'repeated clicks cannot reload twice');
  }
  assert.match(source,/if\(await cache\.match\(request,\{ignoreSearch:true\}\)\)return;/,'hole-fill is guarded: an existing entry is never replaced');
  assert.equal(/\.put\(e\.request/.test(source),false,'no unconditional background put of a fresh fetch remains');
  for(const asset of added){const value=asset.url;if(!value.startsWith('./')||value==='./')continue;assert.equal(fs.existsSync(path.join(root,value.slice(2))),true,`missing cached asset ${value}`);}
  console.log('PASS SW serves the cached shell without network, keeps the active cache release-pure and preserves application data');
})().catch(error=>{console.error(error);process.exitCode=1;});
