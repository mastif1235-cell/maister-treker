'use strict';
/* Stage 2D: phone AddressBook → Worker /directory (→ KV → AI).
   Pinned: the projection that leaves the phone (places only), an
   order-independent fingerprint, debounced push after a change, no push when
   nothing changed / AI not configured / offline, pending state survives a
   failure and is flushed at boot and before an AI question, wiring. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {webcrypto}=require('node:crypto');
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const AB=require('../js/address-book');
const Sync=require('../js/address-book-sync');

const book=AB.fromLegacy({cities:['Шевченко','Таромське'],streets:{'Шевченко':['Вул Шевченко'],'Таромське':['Вул Привокзальна']}});
const shev=book.cities.find(c=>c.name==='Шевченко');

/* ---- projection: places only, archived kept as a flag ---- */
const payload=Sync.projection(book);
assert.equal(payload.v,1);
assert.deepEqual(Object.keys(payload.cities[0]).sort(),['active','aliases','id','name','updatedAt']);
assert.deepEqual(Object.keys(payload.streets[0]).sort(),['active','aliases','cityId','id','name','updatedAt']);
assert.equal(payload.cities.length,2);assert.equal(payload.streets.length,2);
assert.ok(!JSON.stringify(payload).includes('createdAt'));
assert.deepEqual(Sync.projection(null),{v:1,cities:[],streets:[]});

/* ---- fingerprint: content, not order; every semantic change is visible ---- */
const fp=Sync.fingerprint(payload);
assert.equal(Sync.fingerprint({v:1,cities:payload.cities.slice().reverse(),streets:payload.streets.slice().reverse()}),fp,'order does not matter');
AB.update(book,'streets',book.streets[0].id,{aliases:['Вулиця Шевченка']});
const fpAlias=Sync.fingerprint(Sync.projection(book));
assert.notEqual(fpAlias,fp,'alias change is a change');
AB.update(book,'streets',book.streets[0].id,{active:false});
assert.notEqual(Sync.fingerprint(Sync.projection(book)),fpAlias,'archive is a change');
AB.update(book,'streets',book.streets[0].id,{active:true});

/* ---- syncer harness ---- */
function harness(options={}){
  const calls=[];const timers=[];const store=new Map();
  let now=1_000_000;let ready=options.ready!==false;let online=true;let respond=options.respond||(()=>({status:200,body:{ok:true,cities:2,streets:2}}));
  const syncer=Sync.createSyncer({
    getBook:()=>book,
    getConfig:()=>({ready,backendUrl:'https://worker.example.test',bearer:'secret-token'}),
    fetchImpl:async(url,init)=>{calls.push({url,init});const r=respond(calls.length);if(r.throw)throw r.throw;return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>r.body};},
    storage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v)},
    now:()=>now,online:()=>online,
    setTimer:(fn,ms)=>{const id=timers.length+1;timers.push({id,fn,ms,fired:false});return id;},
    clearTimer:id=>{const t=timers.find(x=>x.id===id);if(t)t.fired=true;},
    debounceMs:2500
  });
  const fire=()=>{const pending=timers.filter(t=>!t.fired);pending.forEach(t=>{t.fired=true;t.fn();});return pending.length;};
  return {syncer,calls,timers,store,fire,setReady:v=>{ready=v;},setOnline:v=>{online=v;},setRespond:fn=>{respond=fn;},tick:ms=>{now+=ms;}};
}

(async()=>{
  /* 1. not configured → nothing leaves the phone */
  {
    const h=harness({ready:false});
    assert.equal(h.syncer.schedule(),false);
    assert.deepEqual(await h.syncer.flush(),{ok:false,reason:'not_configured'});
    assert.equal(h.calls.length,0);
    assert.equal(h.syncer.status().configured,false);
  }
  /* 2. first change → debounced single POST with the projection; state stored */
  {
    const h=harness();
    assert.equal(h.syncer.status().pending,true,'never pushed → pending');
    assert.equal(h.syncer.schedule(),true);
    assert.equal(h.syncer.schedule(),true,'second edit re-arms the same debounce');
    assert.equal(h.calls.length,0,'nothing sent before the debounce fires');
    h.fire();
    await new Promise(r=>setImmediate(r));
    assert.equal(h.calls.length,1,'a burst of edits is ONE request');
    assert.equal(h.calls[0].url,'https://worker.example.test/directory');
    assert.equal(h.calls[0].init.method,'POST');
    assert.equal(h.calls[0].init.headers.Authorization,'Bearer secret-token');
    const sent=JSON.parse(h.calls[0].init.body);
    assert.deepEqual(sent,Sync.projection(book),'exactly the projection, nothing else');
    assert.ok(!JSON.stringify(sent).match(/clientName|phone|ticket/));
    const state=h.syncer.readState();
    assert.equal(state.fingerprint,Sync.fingerprint(sent));assert.equal(state.backendUrl,'https://worker.example.test');
    assert.equal(h.syncer.status().pending,false);
    assert.equal(h.syncer.status().pushedAt,1_000_000);
    /* unchanged directory → no second request */
    assert.equal(h.syncer.schedule(),false);
    assert.deepEqual(await h.syncer.flush(),{ok:true,skipped:true});
    assert.equal(h.calls.length,1);
    /* a real change → pending again → beforeAsk flushes it synchronously */
    const added=AB.add(book,'streets','Вул Нова',shev.id);
    assert.equal(h.syncer.status().pending,true);
    const before=await h.syncer.beforeAsk();
    assert.equal(before.ok,true);assert.equal(h.calls.length,2);
    assert.ok(JSON.parse(h.calls[1].init.body).streets.some(s=>s.id===added.id),'the new street travelled');
    assert.deepEqual(await h.syncer.beforeAsk(),{ok:true,skipped:true},'nothing pending → no wait');
    /* force = explicit «send now» */
    assert.equal((await h.syncer.flush({force:true})).ok,true);assert.equal(h.calls.length,3);
  }
  /* 3. failures keep the change pending; boot and network-back retry it */
  {
    const h=harness({respond:n=>n===1?{status:503,body:{error:'directory_unavailable'}}:{status:200,body:{ok:true,cities:2,streets:3}}});
    const first=await h.syncer.flush();
    assert.deepEqual(first,{ok:false,reason:'unavailable',status:503});
    assert.equal(h.syncer.status().pending,true);assert.equal(h.syncer.status().lastError,'unavailable');
    assert.equal(h.syncer.boot(),true,'boot sees the pending push');
    h.fire();await new Promise(r=>setImmediate(r));
    assert.equal(h.calls.length,2);assert.equal(h.syncer.status().pending,false);assert.equal(h.syncer.status().lastError,null);
    assert.equal(h.syncer.boot(),false,'nothing pending → boot is silent');
  }
  /* 4. offline / auth / network errors are reported, never thrown */
  {
    const h=harness();
    h.setOnline(false);
    assert.deepEqual(await h.syncer.flush(),{ok:false,reason:'offline'});
    assert.equal(h.calls.length,0);
    h.setOnline(true);
    h.setRespond(()=>({status:401,body:{error:'unauthorized'}}));
    assert.equal((await h.syncer.flush()).reason,'auth');
    h.setRespond(()=>({throw:Object.assign(new Error('boom'),{name:'TypeError'})}));
    assert.equal((await h.syncer.flush()).reason,'network');
    assert.equal(h.syncer.status().pending,true);
  }
  /* 5. a different backend URL means «not pushed there yet» */
  {
    const h=harness();
    await h.syncer.flush();
    h.store.set(Sync.STORAGE_KEY,JSON.stringify(Object.assign(h.syncer.readState(),{backendUrl:'https://other.example.test'})));
    assert.equal(h.syncer.status().pending,true);
  }
  /* ---- wiring ---- */
  const ui=read('js/address-book-ui.js');
  assert.match(ui,/if\(saveSettings\(\)===false\)throw[\s\S]{0,400}mtDirectorySyncSchedule\(\)/,'every persisted directory change schedules a push');
  assert.ok(ui.includes('function mtAddressBookRenderSyncStatus'),'settings show the push status');
  assert.ok(read('js/ai/ai-chat.js').includes("if(typeof deps.beforeAsk === 'function'){ try{ await deps.beforeAsk(); }catch(_e){} }"),'chat flushes a pending push before /ask');
  assert.ok(read('js/ai/ai-ui.js').includes('mtDirectorySyncBeforeAsk'),'UI wires the hook');
  assert.match(read('app.js'),/mtDirectorySyncBoot\(\);[\s\S]{0,400}window\.__mtAppInitDone = true;/,'boot flush runs at the end of init, after secrets are restored');
  const html=read('index.html');
  assert.ok(html.indexOf('js/address-book.js')<html.indexOf('js/address-book-sync.js')&&html.indexOf('js/address-book-sync.js')<html.indexOf('js/address-book-ui.js'),'module loads between the directory and its UI');
  assert.ok(html.includes('id="addressDirectorySync"'));
  assert.ok(read('sw.js').includes("'./js/address-book-sync.js'"),'precached for offline boot');
  assert.match(html,/connect-src[^;]*https:\/\/maister-tracker-mcp\.mastif1235\.workers\.dev/,'CSP already allows the AI backend the push goes to');
  const client=read('js/ai/ai-client.js');
  assert.match(client,/QC_INHERITABLE = \[[^\]]*'city_id','street_id'/,'the follow-up context mirror carries the directory identity');
  assert.match(client,/key === 'city_id' \|\| key === 'street_id'[\s\S]{0,120}QC_ID_RE\.test\(v\)/,'ids are echoed back only in UUID shape');
  console.log('PASS address-book sync: projection, fingerprint, debounce, skip-unchanged, failure/pending/boot/beforeAsk, wiring');
})().catch(error=>{console.error(error);process.exit(1);});
