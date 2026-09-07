'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),source=fs.readFileSync(path.join(root,'sw.js'),'utf8'),appSource=fs.readFileSync(path.join(root,'app.js'),'utf8'),handlers={},deleted=[],added=[],puts=[];let localTouches=0,idbTouches=0,networkResolve;
assert.match(source,/CACHE_NAME\s*=\s*'maister-treker-v66-runtime-43'/,'installed-PWA cache revision is unique for v91.6');
assert.match(appSource,/APP_VERSION\s*=\s*'v91\.6 · 2026-09-07'/,'canonical release identity is v91.6');
assert.match(appSource,/register\('sw\.js',\{updateViaCache:'none'\}\)/,'browser cache cannot suppress the service-worker update check');
assert.match(appSource,/let serviceWorkerRefreshing=false[\s\S]*if\(serviceWorkerRefreshing\) return;[\s\S]*window\.location\.reload\(\)/,'controllerchange reload is guarded against a loop');
assert.match(fs.readFileSync(path.join(root,'js','security-audit-fixes-v65-18-9.js'),'utf8'),/SECURITY_AUDIT_RELEASE_LABEL\s*=\s*'v91\.6 · 2026-09-07'/);
const cachedNavigation={kind:'cached-navigation'},cachedScript={kind:'cached-script'};
const cache={addAll:async assets=>added.push(...assets),put:async(request,response)=>puts.push([request,response])};
const caches={open:async()=>cache,keys:async()=>['maister-treker-v66-runtime-42','unrelated-cache'],delete:async key=>{deleted.push(key);return true;},match:async request=>{const value=String(request?.url||request);if(value.includes('app.js'))return cachedScript;if(value.includes('index.html')||value.endsWith('/'))return cachedNavigation;return null;}};
const context={URL,Request:class Request{constructor(url,options){this.url=url;this.cache=options&&options.cache;}},fetch:()=>new Promise(resolve=>{networkResolve=resolve;}),caches,clients:{matchAll:async()=>[],claim:async()=>{}},self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting:()=>{}},localStorage:new Proxy({},{get(){localTouches++;}}),indexedDB:new Proxy({},{get(){idbTouches++;}})};context.self.clients=context.clients;vm.createContext(context);vm.runInContext(source,context);
async function fire(name){let promise;handlers[name]({waitUntil:p=>{promise=p;}});await promise;}
async function fetchEvent(request){let response;const waits=[];handlers.fetch({request,respondWith:p=>{response=p;},waitUntil:p=>waits.push(p)});return{value:await Promise.race([response,new Promise((_,reject)=>setTimeout(()=>reject(new Error('cached startup waited for network')),50))]),waits};}
(async()=>{
  await fire('install');await fire('activate');
  assert.ok(added.some(item=>item.url==='./index.html'&&item.cache==='reload'));assert.ok(deleted.includes('maister-treker-v66-runtime-42'));
  const navigation=await fetchEvent({url:'https://example.test/index.html?v=91.6',mode:'navigate',method:'GET'});assert.equal(navigation.value,cachedNavigation,'cached navigation is immediate while network hangs');assert.equal(navigation.waits.length,1,'navigation refresh continues in background');networkResolve({status:200,clone(){return this;}});await navigation.waits[0];
  const script=await fetchEvent({url:'https://example.test/app.js?v=91.6',mode:'same-origin',method:'GET'});assert.equal(script.value,cachedScript,'cached core JS is immediate while network hangs');assert.equal(script.waits.length,1,'core-code refresh continues in background');networkResolve({status:200,clone(){return this;}});await script.waits[0];assert.equal(puts.length,2,'successful background refresh updates the current cache');
  assert.equal(localTouches,0);assert.equal(idbTouches,0);assert.equal(/Clear-Site-Data|indexedDB|localStorage|deleteDatabase/.test(source),false);assert.equal(/Clear-Site-Data|deleteDatabase/.test(appSource),false);
  for(const asset of added){const value=asset.url;if(!value.startsWith('./')||value==='./')continue;assert.equal(fs.existsSync(path.join(root,value.slice(2))),true,`missing cached asset ${value}`);}
  console.log('PASS SW v91.6 starts cached navigation/code without waiting for network, refreshes in background and preserves application data');
})().catch(error=>{console.error(error);process.exitCode=1;});
