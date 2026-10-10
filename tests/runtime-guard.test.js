'use strict';
/* v91.95 / runtime-140. Обов'язкова регресія №8: змішаний runtime (модулі/SW
   різних ревізій) → один безпечний reload із sessionStorage-обмежувачем циклу;
   повторний mismatch → fail closed (flush не запускається, дані не чіпаються);
   консистентний runtime → без reload. Плюс: SW-кеш з тим самим runtime-токеном
   (навіть з release-суфіксом) вважається узгодженим. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

function bootGuard(opts={}){
  const store=new Map(Object.entries(opts.initialStore||{})),reloads=[],channels=[];
  const revisions=Object.assign({app:'runtime-140',report:'runtime-140',renderer:'runtime-140',compact:'runtime-140'},opts.revisions||{});
  const ctx={
    setTimeout,clearTimeout,
    sessionStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    MTAppRuntimeRevision:revisions.app,
    MTTicketRendererRevision:revisions.renderer,
    MTTicketCompactView:{runtimeRevision:revisions.compact},
    MTDispatcherReportClient:{runtimeRevision:revisions.report},
    MessageChannel:class{constructor(){const s=this;this.port1={onmessage:null};this.port2={close(){}};channels.push(s);this.deliver=data=>{if(typeof s.port1.onmessage==='function')s.port1.onmessage({data});};}},
    location:{reload:()=>{reloads.push(Date.now());}}
  };
  ctx.navigator={serviceWorker:opts.noController?{}:{controller:{postMessage:(msg,ports)=>{assert.equal(msg.type,'MT_RUNTIME_STATUS');const channel=channels.at(-1);queueMicrotask(()=>channel.deliver(opts.swAnswer===undefined?{cacheName:'maister-treker-v70-runtime-140'}:opts.swAnswer));}}}};
  vm.runInNewContext(read('js/runtime-guard.js'),ctx,{filename:'js/runtime-guard.js'});
  return {guard:ctx.MTDispatcherRuntimeGuard,reloads,store,ctx};
}

(async()=>{
  // 1) консистентний runtime (модулі + SW-cache) → ok, без reload.
  {
    const h=bootGuard();
    await new Promise(r=>setTimeout(r,10));
    assert.equal(h.guard.blocked(),false,'consistent runtime is not blocked');
    assert.equal(h.guard.state(),'ok');
    assert.deepEqual(h.reloads,[],'no reload on a consistent runtime');
  }
  // 2) один із модулів старий → РІВНО ОДИН reload; повторний boot → fail closed.
  {
    const h=bootGuard({revisions:{renderer:'runtime-136'}});
    assert.equal(h.reloads.length,1,'exactly one automatic reload');
    assert.equal(h.store.get('mtRuntimeGuardReloadV1'),'1','sessionStorage loop-guard is armed');
    assert.equal(h.guard.blocked(),true,'pre-reload the guard blocks the flush');
    // «reload»: новий boot з тією ж розбіжністю і тим самим sessionStorage.
    const second=bootGuard({revisions:{renderer:'runtime-136'},initialStore:{mtRuntimeGuardReloadV1:'1'}});
    assert.equal(second.reloads.length,0,'loop-guard prevents a reload storm');
    assert.equal(second.guard.state(),'failed','mismatch persists → fail closed');
    assert.equal(second.guard.blocked(),true);
    assert.equal(second.store.get('mtRuntimeGuardReloadV1'),'1','guard state is preserved, never cleared');
  }
  // 3) SW runtime-136 (старий SW) при нових модулях → mismatch → один reload.
  {
    const h=bootGuard({swAnswer:{cacheName:'maister-treker-v67-runtime-136'}});
    await new Promise(r=>setTimeout(r,10));
    assert.equal(h.reloads.length,1,'old SW cache is a runtime mismatch');
    assert.equal(h.guard.blocked(),true);
  }
  // 4) SW-кеш з тим самим runtime-токеном + release-суфікс (e2e-update) → узгоджений.
  {
    const h=bootGuard({swAnswer:{cacheName:'maister-treker-v70-runtime-140-e2e-update'}});
    await new Promise(r=>setTimeout(r,10));
    assert.equal(h.guard.blocked(),false,'same runtime token with a release suffix is consistent');
    assert.deepEqual(h.reloads,[],'no reload for an e2e-renamed cache');
  }
  // 5) evaluate(): чиста функція сумісності модулів.
  {
    const h=bootGuard({noController:true});
    assert.equal(h.guard.evaluate({app:'runtime-140',report:'runtime-140',renderer:'runtime-140',compact:'runtime-140'},'maister-treker-v70-runtime-140').ok,true);
    assert.equal(h.guard.evaluate({app:'runtime-140',report:'runtime-136',renderer:'runtime-140',compact:'runtime-140'},'maister-treker-v70-runtime-140').ok,false);
    assert.equal(h.guard.evaluate({app:'runtime-140',report:'runtime-140',renderer:'runtime-140',compact:'runtime-140'},'maister-treker-v67-runtime-136').ok,false);
  }
  // 6) flush-зв'язка: заблокований runtime-guard зупиняє flush і syncAll, але
  //    не чіпає чергу (жодних видалень/помилок), і fail closed зберігається.
  {
    const storage=new Map(),calls=[],timers=[];
    let raw=null;
    const ctx={globalThis:{localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)}},URL,setTimeout,clearTimeout};
    vm.runInNewContext(read('js/dispatcher-telemetry.js'),ctx,{filename:'js/dispatcher-telemetry.js'});
    vm.runInNewContext(read('js/dispatcher-report-client.js'),ctx,{filename:'js/dispatcher-report-client.js'});
    ctx.globalThis.MTDispatcherRuntimeGuard={blocked:()=>true,state:()=> 'failed',reason:()=>'MIXED_RUNTIME'};
    const config={dispatcherReportEndpoint:'https://script.google.com/macros/s/test/exec',dispatcherReportEnabled:true};
    const tickets=[{id:'t-guarded'}];
    const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>{raw=v;}},settings:()=>config,tickets:()=>tickets,ticket:id=>tickets.find(t=>t.id===id)||null,
      dto:async(t,v)=>({ticket_id:t.id,source_version:v}),now:()=>Date.now(),requestId:()=>crypto.randomUUID(),online:()=>true,
      setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
      send:async(_u,r)=>{calls.push(r);return {ok:true,inserted:r.tickets.length,updated:0,unchanged:0,deleted:r.deletes.length,rejected:0,errors:0};}};
    const q=ctx.globalThis.MTDispatcherReportClient.createOutbox(deps);
    assert.equal(q.enqueueUpsert({id:'t-guarded'}),true,'enqueue stays durable while the guard is closed');
    await q.flush();
    assert.equal(calls.length,0,'mixed runtime never runs the dispatcher flush');
    const meta=JSON.parse(raw);
    assert.equal(meta.operations.length,1,'queue is preserved untouched');
    assert.equal(meta.operations[0].error,'','fail-closed flush sets no error');
    assert.equal(meta.operations[0].attempts,0,'fail-closed flush burns no attempts');
    await assert.rejects(q.syncAll(),/REPORT_RUNTIME_MIXED/,'manual sync fails with an explicit code instead of wiping');
    assert.equal(JSON.parse(raw).operations.length,1,'syncAll failure also preserves the queue');
    assert.ok(ctx.globalThis.MTDispatcherTelemetry.dump().some(e=>e.event==='flush_attempt'&&e.code==='RUNTIME_GUARD'),'guard-blocked flush is recorded');
  }
  console.log('PASS mixed-runtime guard: one safe reload, loop-guard fail closed, SW token consistency, flush blocked without data loss');
})().catch(e=>{console.error(e);process.exitCode=1;});
