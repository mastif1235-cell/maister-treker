'use strict';
/* Регресія аудиту (останній пункт P1 по SW): усередині одного активного кешу
   не повинно з'являтися файлів із різних релізів. Симулюємо відкритий
   застосунок релізу A, доки сервер already віддає B:
     - index.html/app.js/styles.css — віддаються з кешу, мережа B не повинна
       ПІДМІНИТИ жодного активного запису (детектор порушень ловить будь-який
       put поверх існуючого ключа з іншим вмістом);
     - офлайн-робота зберігається: кешовані файли віддаються без мережі;
     - «дірка» встановлення латається додаванням (ключ відсутній — це не підміна).
   Новий набір може стати активним лише окремим SW/CACHE_NAME (це покривають
   sw-upgrade-static + sw-update-resilience). */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'sw.js'),'utf8');

const RELEASE_A={'/':'A-index','/index.html':'A-index','/app.js':'A-app','/styles.css':'A-css','/js/late-audio.js':'A-late'};
const RELEASE_B={'/':'B-index','/index.html':'B-index','/app.js':'B-app','/styles.css':'B-css','/js/late-audio.js':'B-late'};

function harness({seed,network,offline=false}){
  const store=new Map(Object.entries(seed));
  const violations=[]; // будь-яка підміна існуючого запису іншим вмістом
  const fills=[];     // легітимні латки відсутніх ключів
  const handlers={};
  let fetched=0;
  const body=r=>r&&Object.prototype.hasOwnProperty.call(r,'body')?r.body:undefined;
  const keyOf=request=>new URL(String(request.url||request)).pathname;
  const cache={
    addAll:async()=>{},add:async()=>{},
    match:async request=>{const k=keyOf(request);return store.has(k)?{body:store.get(k)}:null;},
    put:async(request,response)=>{store.set(keyOf(request),response.body);}
  };
  const caches={
    open:async()=>cache,keys:async()=>[],delete:async()=>true,
    match:async request=>cache.match(request)
  };
  const context={
    console:{warn(){},error(){},log(){}},
    URL,
    caches,
    clients:{matchAll:async()=>[],claim:async()=>{}},
    fetch:request=>{fetched++;
      if(offline)return Promise.reject(new Error('offline'));
      const k=keyOf(request);
      const bodyText=Object.prototype.hasOwnProperty.call(network,k)?network[k]:undefined;
      return bodyText===undefined?Promise.reject(new Error('404'))
        :Promise.resolve({status:200,body:bodyText,clone(){return this;}});},
    self:{location:{origin:'https://app.test'},addEventListener:(n,f)=>{handlers[n]=f;},skipWaiting:async()=>{}}
  };
  context.self.clients=context.clients;
  vm.createContext(context);
  vm.runInContext(source,context);
  async function fire(request){
    let response;
    handlers.fetch({request,respondWith:p=>{response=p;},waitUntil:()=>{}});
    return await response;
  }
  return {store,violations,fills,caches,
    get fetched(){return fetched;},
    async fetch(request){
      const res=await fire(request);
      return res?{body:body(res)}:res;
    },
    // інспектор: усі put у активний кеш проходять тут (перехоплення cache.put)
    instrument(){
      const originalPut=cache.put.bind(cache);
      cache.put=async(request,response)=>{
        const k=keyOf(request);
        if(store.has(k)){ if(store.get(k)!==response.body) violations.push([k,store.get(k),response.body]); }
        else fills.push(k);
        return originalPut(request,response);
      };
      return this;
    }};
}

(async()=>{
  // 1) Реліз A у кеші, сервер уже на B: жодного змішування, жодного мережевого
  //    трафіку на підміну, усе з кешу.
  {
    const h=harness({seed:RELEASE_A,network:RELEASE_B}).instrument();
    assert.equal((await h.fetch({url:'https://app.test/?v=91.7',mode:'navigate',method:'GET'})).body,'A-index','документ — з поточного кешу');
    assert.equal((await h.fetch({url:'https://app.test/app.js?v=91.7',mode:'same-origin',method:'GET'})).body,'A-app','кешований JS не оновлюється на льоту');
    assert.equal((await h.fetch({url:'https://app.test/styles.css',mode:'same-origin',method:'GET'})).body,'A-css','кешований CSS не оновлюється на льоту');
    assert.equal(h.violations.length,0,'ЖОДНОГО put, що підмінив би файл активного кешу — версії не змішуються');
    assert.equal(h.fetched,0,'cached shell вообще не смикає мережу');
    assert.deepEqual([...h.store.entries()],Object.entries(RELEASE_A),'вміст кешу дослівно незмінний');
  }
  // 2) Офлайн: той самий кеш serve'ить без мережі; жодного «оновлення» не потребує.
  {
    const h=harness({seed:RELEASE_A,network:{},offline:true}).instrument();
    assert.equal((await h.fetch({url:'https://app.test/app.js',mode:'same-origin',method:'GET'})).body,'A-app','офлайн кешований файл віддається як і раніше');
    assert.equal((await h.fetch({url:'https://app.test/index.html',mode:'navigate',method:'GET'})).body,'A-index','офлайн навігація працює');
    // дірка офлайн — чесно null (як і раніше), без падіння й без викиду
    assert.equal(await h.fetch({url:'https://app.test/js/never-installed.js',mode:'same-origin',method:'GET'}),null,'некешований файл офлайн не ламає воркер');
  }
  // 3) Дірка встановлення латається єдиним легітимним записом — і лише одного разу.
  {
    const seed={...RELEASE_A};delete seed['/js/late-audio.js'];
    const h=harness({seed,network:RELEASE_B}).instrument();
    assert.equal((await h.fetch({url:'https://app.test/js/late-audio.js',mode:'same-origin',method:'GET'})).body,'B-late','бракуючий файл дістається з мережі');
    assert.deepEqual(h.fills,['/js/late-audio.js'],'запис — лише до відсутнього ключа (латка, не підміна)');
    assert.equal(h.violations.length,0);
    assert.equal((await h.fetch({url:'https://app.test/js/late-audio.js',mode:'same-origin',method:'GET'})).body,'B-late','наступний візит — уже з кешу');
    assert.equal((await h.fetch({url:'https://app.test/app.js',mode:'same-origin',method:'GET'})).body,'A-app','сусідні файли лишились релізу A — латка їх не чіпає');
  }
  // 4) Статична гарантія: у fetch-шляху немає жодного безумовного put у кеш.
  {
    assert.equal(/\.put\(e\.request/.test(source),false,'безумовного put свіжого fetch більше немає');
    assert.match(source,/if\(await cache\.match\(request,\{ignoreSearch:true\}\)\)return;/,'put захищений перевіркою «запису немає»');
    assert.equal((source.match(/await cache\.put\(/g)||[]).length,1,'рівно одна точка запису в активний кеш з fetch');
  }
  console.log('PASS active SW cache never mixes release versions; only gap-fills are written, offline stays intact');
})().catch(e=>{console.error(e);process.exitCode=1;});
