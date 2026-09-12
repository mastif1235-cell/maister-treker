'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'sw.js'),'utf8'),appSource=fs.readFileSync(path.join(root,'app.js'),'utf8'),handlers={},deleted=[],added=[],puts=[];let localTouches=0,idbTouches=0,networkResolve,skipWaitingCalls=0,reloadCalls=0,messageHandler;
assert.match(source,/CACHE_NAME\s*=\s*'maister-treker-v66-runtime-65'/,'installed-PWA cache revision is unique for the v91.26 post-audit fixes release');
assert.match(appSource,/APP_VERSION\s*=\s*'v91\.26 · 2026-09-12'/,'canonical release identity is v91.26');
assert.match(appSource,/register\('sw\.js',\{updateViaCache:'none'\}\)/,'browser cache cannot suppress the service-worker update check');
assert.match(appSource,/function serviceWorkerUpdateIsSafe\(\)[\s\S]*hasUnsavedChanges\(\)[\s\S]*modalRoot[\s\S]*toolsSpeedController[\s\S]*isPointPlacementActive/,'update is deferred while a form, modal, speed test or map placement is active');
assert.match(appSource,/function serviceWorkerApplyUpdate\(\)[\s\S]*if\(serviceWorkerRefreshing\) return false;[\s\S]*saveDraftToLocalStorage\(\)[\s\S]*window\.location\.reload\(\)/,'reload stays single-shot and still saves the draft');
assert.match(appSource,/Доступне оновлення застосунку/,'an update offer is shown instead of a sudden reload');
assert.match(appSource,/appUpdateApplyBtn[\s\S]*appUpdateLaterBtn/,'the offer has explicit update and later actions');
assert.match(appSource,/serviceWorkerUpdateIsSafe\(\)\)\{ serviceWorkerApplyUpdate\(\); return; \}[\s\S]*serviceWorkerShowUpdateOffer\(\)/,'idle state updates immediately, busy state only offers');
assert.doesNotMatch(fs.readFileSync(path.join(root,'js','security-audit-fixes-v65-18-9.js'),'utf8'),/SECURITY_AUDIT_RELEASE_LABEL/);
const cachedNavigation={kind:'cached-navigation'},cachedScript={kind:'cached-script'};
const cache={addAll:async assets=>added.push(...assets),put:async(request,response)=>puts.push([request,response])};
const caches={open:async()=>cache,keys:async()=>['maister-treker-v66-runtime-42','unrelated-cache'],delete:async key=>{deleted.push(key);return true;},match:async request=>{const value=String(request?.url||request);if(value.includes('app.js'))return cachedScript;if(value.includes('index.html')||value.endsWith('/'))return cachedNavigation;return null;}};
const context={URL,Request:class Request{constructor(url,options){this.url=url;this.cache=options&&options.cache;}},fetch:()=>new Promise(resolve=>{networkResolve=resolve;}),caches,clients:{matchAll:async()=>[],claim:async()=>{}},self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting:async()=>{skipWaitingCalls++;}},localStorage:new Proxy({},{get(){localTouches++;}}),indexedDB:new Proxy({},{get(){idbTouches++;}})};context.self.clients=context.clients;vm.createContext(context);vm.runInContext(source,context);
async function fire(name){let promise;handlers[name]({waitUntil:p=>{promise=p;}});await promise;}
async function fetchEvent(request){let response;const waits=[];handlers.fetch({request,respondWith:p=>{response=p;},waitUntil:p=>waits.push(p)});return{value:await Promise.race([response,new Promise((_,reject)=>setTimeout(()=>reject(new Error('cached startup waited for network')),50))]),waits};}
(async()=>{
  await fire('install');await fire('activate');
  assert.ok(added.some(item=>item.url==='./index.html'&&item.cache==='reload'));assert.equal(skipWaitingCalls,1,'activation is requested only after the complete shell is cached');assert.ok(deleted.includes('maister-treker-v66-runtime-42'));assert.equal(deleted.includes('unrelated-cache'),false,'activation only removes app-owned caches');
  const navigation=await fetchEvent({url:'https://example.test/index.html?v=91.6',mode:'navigate',method:'GET'});assert.equal(navigation.value,cachedNavigation,'cached navigation is immediate while network hangs');assert.equal(navigation.waits.length,1,'navigation refresh continues in background');networkResolve({status:200,clone(){return this;}});await navigation.waits[0];
  const script=await fetchEvent({url:'https://example.test/app.js?v=91.6',mode:'same-origin',method:'GET'});assert.equal(script.value,cachedScript,'cached core JS is immediate while network hangs');assert.equal(script.waits.length,1,'core-code refresh continues in background');networkResolve({status:200,clone(){return this;}});await script.waits[0];assert.equal(puts.length,2,'successful background refresh updates the current cache');
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
  assert.equal(idle.handlers.message,undefined,'repeated MT_SW_ACTIVATED messages cannot trigger reloads');

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
  for(const asset of added){const value=asset.url;if(!value.startsWith('./')||value==='./')continue;assert.equal(fs.existsSync(path.join(root,value.slice(2))),true,`missing cached asset ${value}`);}
  console.log('PASS SW starts cached navigation/code without waiting for network, refreshes in background and preserves application data');
})().catch(error=>{console.error(error);process.exitCode=1;});
