'use strict';
/* v91.95 / runtime-141. Обов'язкова регресія №7: змішані старі/нові кеші —
   старий ассет НІКОЛИ не подається. Контракт:
   1) SW обслуговує ЛИШЕ власний іменований кеш CACHE_NAME (без глобального
      caches.match, без пошуку в чужих/старих кешах);
   2) активація прибирає лише старі власні кеші, сторонні не чіпає;
   3) кожен <script src> з index.html входить у CORE_ASSETS (boot completeness:
      половина нової/старої версії в кеші неможлива);
   4) runtime-токени app/dispatcher-render/compact/GW збігаються з токеном
      CACHE_NAME, а runtime-proof.json відповідає реальним байтам файлів. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const swSource=read('sw.js'),html=read('index.html');

(async()=>{


// 1) лише іменований кеш: жодних глобальних пошуків по чужих кешах.
{
  assert.ok(!/caches\.match\(/.test(swSource),'sw.js must never look up the global caches.match (mixed-cache leak)');
  const opens=[...swSource.matchAll(/caches\.open\(([^)]*)\)/g)].map(m=>m[1].trim());
  assert.ok(opens.length>0);
  for(const arg of opens)assert.equal(arg,'CACHE_NAME','every cache open uses the release-named cache: '+arg);
  assert.ok(swSource.includes('if(await cache.match(request,{ignoreSearch:true}))return;'),'gap-fill never replaces an existing cached asset');
}
// 2) install/activate: старі власні кеші видаляються, сторонні лишаються.
{
  const handlers={},deleted=[],added=[];
  const indexHit={text:async()=>html,clone(){return this;},arrayBuffer:async()=>new ArrayBuffer(0)};
  const cache={addAll:async assets=>{added.push(...assets);},put:async()=>{},match:async req=>String(req?.url||req).includes('index.html')?indexHit:{}};
  const caches={open:async()=>cache,keys:async()=>['maister-treker-v66-runtime-42','maister-treker-v67-runtime-136','unrelated-cache'],delete:async key=>{deleted.push(key);return true;},match:async()=>null};
  const context={URL:URL,Request:function(url){this.url=url;},fetch:async function(){return null;},caches:caches,clients:{matchAll:async()=>[],claim:async()=>{}},self:{location:{origin:'https://example.test'},addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting:async()=>{}},localStorage:new Proxy({},{get(){return undefined;}}),indexedDB:new Proxy({},{get(){return undefined;}})};
  context.self.clients=context.clients;
  vm.createContext(context);vm.runInContext(swSource,context);
  const fire=async name=>{const waits=[];handlers[name]({waitUntil:p=>{waits.push(p);}});await Promise.all(waits);};
  await fire('install');await fire('activate');
  assert.ok(deleted.includes('maister-treker-v66-runtime-42'),'old app-owned cache is removed');
  assert.ok(deleted.includes('maister-treker-v67-runtime-136'),'previous release cache is removed');
  assert.ok(!deleted.includes('unrelated-cache'),'unrelated caches are never touched');
  assert.ok(!added.some(a=>typeof a==='object'&&a.url&&!String(a.url).startsWith('./')),'only same-origin assets are precached');
}
// 3) boot completeness: кожен скрипт index.html у CORE_ASSETS (і на диску).
{
  const scripts=[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m=>m[1]);
  assert.ok(scripts.length>50);
  for(const script of scripts){
    assert.ok(swSource.includes("'./"+script+"'"),'every index.html script is precached: '+script);
    assert.ok(fs.existsSync(path.join(root,script)),'cached script exists on disk: '+script);
  }
}
// 4) runtime-токени узгоджені з CACHE_NAME + proof відповідає реальним байтам.
{
  const cacheName=swSource.match(/const CACHE_NAME = '([^']+)'/)[1];
  const token=(cacheName.match(/runtime-\d+/)||[])[0];
  assert.ok(token,'CACHE_NAME carries a runtime token');
  assert.ok(read('app.js').includes("globalThis.MTAppRuntimeRevision = '"+token+"'"),'app runtime token matches the cache');
  assert.ok(read('js/dispatcher-report-client.js').includes("runtimeRevision:'"+token+"'"),'dispatcher client revision matches the cache');
  assert.ok(read('js/tickets-render.js').includes("MTTicketRendererRevision='"+token+"'"),'tickets renderer revision matches the cache');
  assert.ok(read('js/tickets-compact-view.js').includes("runtimeRevision:'"+token+"'"),'compact view revision matches the cache');
  const guard=read('js/runtime-guard.js');
  assert.ok(guard.includes("const EXPECTED='"+token+"'"),'runtime guard expects the release token');
  assert.ok(guard.includes("const CACHE_EXPECTED='"+cacheName+"'"),'runtime guard expects the release cache name');
  // runtime-proof.json: ті самі файли, ті самі байти (старий ассет не сховається).
  const proof=JSON.parse(read('runtime-proof.json'));
  assert.equal(proof.cacheName,cacheName);
  assert.equal(Object.keys(proof.assets).length,8);
  for(const [asset,hash] of Object.entries(proof.assets)){
    const real=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,asset.replace('./','')))).digest('hex');
    assert.equal(hash,real,'runtime-proof hash matches the real file bytes: '+asset);
  }
}
  console.log('PASS SW named-cache isolation, old cache cleanup, boot completeness, runtime token agreement, proof freshness');
})().catch(e=>{console.error(e);process.exitCode=1;});
