'use strict';
/* Атомарний boot runtime Service Worker (fix v91.30, HIGH).
   Харнест виконує РЕАЛЬНИЙ sw.js (vm) із реальним index.html репозиторію:
   інсталює нову версію поверх старої, інжектує збої мережі (503/404) на
   конкретні класичні скрипти й перевіряє ПОВЕДІНКУ install/activate/fetch:
     A. нормальна інсталяція → новий кеш повний → skipWaiting дозволений;
     B. обов'язковий скрипт 503 → install провалюється, старий кеш живий;
     C. обов'язковий скрипт 404 → те саме безпечне відхилення;
     D. лінивий runtime-актив недоступний → boot НЕ блокується;
     E. офлайн-reload після невдалої інсталяції → стара версія працює;
     F. захист від mixed/franken-cache не зламаний (латка лише відсутніх ключів);
     G. успішне оновлення → activate → старий кеш видаляється лише після
        доведеної готовності нового. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
const currentCacheName=source.match(/const CACHE_NAME = '([^']+)'/)[1];
const OLD_CACHE=currentCacheName+'-old';
const NEW_CACHE=currentCacheName;
const OLD_BODY=asset=>`${asset} @ OLD-RELEASE`;

/* Boot-набір, який SW зобов'язаний вивести з index.html (ті самі правила парсингу). */
function parseBootAssets(html){
  const assets=new Set(['./','./index.html','./manifest.json']);
  for(const match of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)){
    const url=match[1]||match[2]||match[3];
    assets.add(url.startsWith('./')?url:'./'+url);
  }
  for(const tag of html.matchAll(/<link\b[^>]*>/gi)){
    if(!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag[0]))continue;
    const href=tag[0].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
    if(href){const url=href[1]||href[2]||href[3];assets.add(url.startsWith('./')?url:'./'+url);}
  }
  return [...assets];
}
const bootAssets=parseBootAssets(indexHtml);
const lazyAssets=['./js/tools-map-maplibre.js','./vendor/maplibre/maplibre-gl.mjs','./qrcode.js'];

/* Статична стійкість: кожен boot-актив index.html має бути і в CORE_ASSETS,
   інакше прекеш його навіть не спробує завантажити (розсинхрон списків). */
{
  const coreAssets=source.match(/const CORE_ASSETS = \[([\s\S]*?)\];/)[1].split(',').map(item=>item.trim().replace(/^'|',?$/g,'')).filter(Boolean);
  for(const asset of bootAssets)assert.ok(coreAssets.includes(asset),`boot-актив ${asset} з index.html відсутній у CORE_ASSETS (розсинхрон списків)`);
}

function releaseBodies(){const map={};for(const asset of new Set([...bootAssets,...lazyAssets]))map[asset]=`${asset} @ ${currentCacheName}`;map['./index.html']=indexHtml;return map;}
function oldRelease(){const map=releaseBodies();for(const key of Object.keys(map))map[key]=key==='./index.html'?indexHtml+'<!--OLD-RELEASE-->':OLD_BODY(key);return map;}
/* Усі ключі сховища нормалізуємо до './'-відносної форми (у реальному SW
   і рядок './js/x.js', і Request('https://host/js/x.js') дають той самий ключ). */
function normPath(value){
  let target=String(value&&value.url||value);
  target=target.replace(/^https?:\/\/[^/]+/,'').split('?')[0];
  if(target==='/')return './';
  if(target.startsWith('/'))return '.'+target;
  return target;
}

/* Спільне сховище кешів: Map<name, Map<path, responseLike>> + журнал операцій. */
function makeCaches({network,failures={},offline=false}){
  const stores=new Map();      // name → Map<path, responseLike>
  const log={puts:[],deletes:[],skipWaiting:0,activatedMessages:[]};
  const responseLike=theBody=>({status:200,ok:true,body:theBody,clone(){return this;},text:async()=>theBody});
  function storeOf(name){if(!stores.has(name))stores.set(name,new Map());return stores.get(name);}
  function doFetch(request){
    if(offline)return Promise.reject(new Error('OFFLINE'));
    const target=normPath(request);
    const failure=failures[target];
    if(failure)return Promise.reject(new Error(failure));
    const theBody=network[target];
    return theBody===undefined?Promise.reject(new Error('HTTP 404 '+target)):Promise.resolve(responseLike(theBody));
  }
  const cacheFor=name=>({
    /* addAll атомарний: спершу отримуємо все, за невдачі — жодного put. */
    addAll:async requests=>{
      const fetched=[];
      for(const request of requests){
        const target=normPath(request);
        const failure=failures[target];
        if(failure)throw new Error(failure);
        const theBody=network[target];
        if(theBody===undefined)throw new Error('HTTP 404 '+target);
        fetched.push([target,theBody]);
      }
      for(const [target,theBody] of fetched)storeOf(name).set(target,responseLike(theBody));
    },
    add:async request=>{const response=await doFetch(request);storeOf(name).set(normPath(request),response);},
    put:async(request,response)=>{log.puts.push([name,normPath(request)]);storeOf(name).set(normPath(request),response);},
    match:async request=>{const hit=storeOf(name).get(normPath(request));return hit?responseLike(hit.body):undefined;},
    keys:async()=>[...storeOf(name).keys()],
  });
  const caches={
    open:async name=>cacheFor(name),
    keys:async()=>[...stores.keys()],
    delete:async name=>{log.deletes.push(name);return stores.delete(name);},
    match:async request=>{
      for(const store of stores.values()){const hit=store.get(normPath(request));if(hit)return responseLike(hit.body);}
      return undefined;
    },
  };
  function makeWorker(cacheName){
    const handlers={};
    const clients={matchAll:async()=>[{postMessage:message=>log.activatedMessages.push(message)}],claim:async()=>{}};
    const context={
      console,URL,Set,Array,Promise,caches,
      Request:class Request{constructor(url,options){this.url=new URL(url,'https://app.test/').href;this.cache=options&&options.cache;}},
      fetch:doFetch,
      clients,
      self:{location:{origin:'https://app.test'},addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting:async()=>{log.skipWaiting++;}},
    };
    context.self.clients=clients;
    vm.createContext(context);
    vm.runInContext(cacheName===NEW_CACHE?source:source.replace(`const CACHE_NAME = '${currentCacheName}'`,`const CACHE_NAME = '${cacheName}'`),context);
    return {
      handlers,clients,context,
      async fire(name){let promise;handlers[name]({waitUntil:p=>{promise=Promise.resolve(p);}});await promise;},
      async fetchEvent(url,mode){
        let response;const waits=[];
        handlers.fetch({request:{url,method:'GET'},mode:mode||'same-origin',respondWith:p=>{response=p;},waitUntil:p=>waits.push(p)});
        return await response;
      },
    };
  }
  return {stores,log,caches,makeWorker,storeOf,
    seed:(name,bodies)=>{for(const [key,value] of Object.entries(bodies))storeOf(name).set(key,responseLike(value));}};
}

(async()=>{
  /* ── A + G: нормальна інсталяція нової версії поверх старої ── */
  {
    const env=makeCaches({network:{...releaseBodies(),...oldRelease()}});
    env.seed(OLD_CACHE, oldRelease()); // стара версія вже встановлена й активована (повний набір)
    const worker=env.makeWorker(NEW_CACHE);
    await worker.fire('install');
    assert.equal(env.log.skipWaiting,1,'A: усі обов\'язкові активи доступні → install успішний → рівно один skipWaiting (новий кеш готовий)');
    const newStore=env.storeOf(NEW_CACHE);
    for(const asset of bootAssets)assert.ok(newStore.has(asset),`A: boot-актив ${asset} у новому кеші`);
    assert.equal(env.log.puts.filter(([name])=>name===OLD_CACHE).length,0,'A/G: інсталяція нової версії не пише в старий кеш');
    await worker.fire('activate'); // G: activate лише після доведеної готовності нового
    assert.deepEqual([...env.stores.keys()],[NEW_CACHE],'G: старий кеш видаляється лише після безпечної готовності нового');
    for(const asset of bootAssets)assert.ok(env.storeOf(NEW_CACHE).has(asset),`G: повний новий runtime містить ${asset}`);
    assert.deepEqual(env.log.activatedMessages.map(m=>m.type),['MT_SW_ACTIVATED'],'G: сторінка отримує сповіщення активації');
    assert.equal(env.log.activatedMessages[0].upgrade,true,'G: це оновлення наявного встановлення (upgrade:true)');
  }

  /* ── B: обов'язковий classic script (tickets-domain.js) віддає 503 ── */
  {
    const env=makeCaches({network:{...releaseBodies(),...oldRelease()},failures:{'./js/tickets-domain.js':'HTTP 503 Service Unavailable'}});
    env.seed(OLD_CACHE, oldRelease());
    const oldSnapshot=new Map(env.storeOf(OLD_CACHE));
    const worker=env.makeWorker(NEW_CACHE);
    await assert.rejects(()=>worker.fire('install'),/MT_BOOT_RUNTIME_INCOMPLETE.*tickets-domain/,'B: install нової версії провалюється (503 на обов\'язковому скрипті)');
    assert.equal(env.log.skipWaiting,0,'B: skipWaiting НЕ викликається — новий SW не стає робочою версією');
    assert.deepEqual(env.log.deletes,[NEW_CACHE],'B: недобудований новий кеш прибраний');
    assert.equal(env.log.puts.filter(([name])=>name===OLD_CACHE).length,0,'B: збоїна інсталяція не писала в старий кеш');
    assert.deepEqual([...env.storeOf(OLD_CACHE).entries()],[...oldSnapshot.entries()],'B: старий повний кеш недоторканний');
    assert.deepEqual([...env.stores.keys()],[OLD_CACHE],'B: лишається рівно один (старий) кеш');

    /* E: офлайн-reload після невдалої інсталяції — стара версія повністю робоча. */
    const offline=makeCaches({network:{},offline:true});
    offline.stores.set(OLD_CACHE,new Map(env.storeOf(OLD_CACHE)));
    const oldWorker=offline.makeWorker(OLD_CACHE); // старий SW уже активний (стор попередньо заповнений)
    assert.equal((await offline.caches.keys()).length,1,'E: після невдалої інсталяції в офлайні є рівно одна (стара) версія');
    for(const asset of ['index.html','app.js','styles.css','js/tickets-domain.js','js/sync-engine-core.js']){
      const url='https://app.test/'+asset;
      const hit=await oldWorker.fetchEvent(url,asset==='index.html'?'navigate':'same-origin');
      const expected=asset==='index.html'?indexHtml+'<!--OLD-RELEASE-->':OLD_BODY('./'+asset);
      assert.equal(hit&&hit.body,expected,`E: ${asset} офлайн віддається старою робочою версією з кешу`);
    }
  }

  /* ── C: обов'язковий classic script віддає 404 ── */
  {
    const env=makeCaches({network:{...releaseBodies(),...oldRelease()},failures:{'./js/tickets-domain.js':'HTTP 404 Not Found'}});
    env.seed(OLD_CACHE, oldRelease());
    const worker=env.makeWorker(NEW_CACHE);
    await assert.rejects(()=>worker.fire('install'),/MT_BOOT_RUNTIME_INCOMPLETE.*tickets-domain/,'C: 404 на обов\'язковому скрипті так само відхиляє install');
    assert.equal(env.log.skipWaiting,0,'C: skipWaiting НЕ викликався');
    assert.deepEqual([...env.stores.keys()],[OLD_CACHE],'C: старий робочий кеш не знищений');
  }

  /* ── D: ліниві runtime-активи недоступні → boot НЕ блокується ── */
  {
    const network=releaseBodies();
    for(const asset of lazyAssets)delete network[asset];
    const env=makeCaches({network:{...oldRelease(),...network}});
    env.seed(OLD_CACHE, oldRelease());
    const worker=env.makeWorker(NEW_CACHE);
    await worker.fire('install');
    assert.equal(env.log.skipWaiting,1,'D: відсутність лінивих активів не блокує активацію — застосунок здатен стартувати без них');
  }

  /* ── F: захист від mixed/franken-cache не зламаний ── */
  {
    assert.match(source,/if\(await cache\.match\(request,\{ignoreSearch:true\}\)\)return;/,'F: дірка латается лише за відсутності запису (захист від підміни)');
    assert.equal((source.match(/await cache\.put\(/g)||[]).length,1,'F: рівно одна точка запису в активний кеш із fetch');
    const env=makeCaches({network:{}}); // мережа віддає лише 404 — «свіжих» файлів іншого релізу немає
    env.seed(OLD_CACHE, oldRelease());  // активний кеш старого релізу
    const worker=env.makeWorker(OLD_CACHE); // активний воркер: install/activate відбулись раніше, тут лише fetch
    const hit=await worker.fetchEvent('https://app.test/app.js?v=1','same-origin');
    assert.equal(hit&&hit.body,OLD_BODY('./app.js'),'F: наявні записи віддаються з кешу без мережі й без перезапису');
    assert.equal(env.log.puts.filter(([name])=>name===OLD_CACHE).length,0,'F: кешований shell не перезаписується — версії не змішуються');
  }
  console.log('PASS SW install is atomic: incomplete boot runtime never activates, old cache survives, lazy assets stay optional');
})().catch(error=>{console.error(error);process.exitCode=1;});
