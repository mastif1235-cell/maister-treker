'use strict';
/* v91.93 / runtime-138. Обов'язкові регресії durable-enqueue (завдання 1–6, 12, 13):
   1) enqueue з dispatcherReportEnabled=false → операція збережена, авто-відправка НЕ виконується;
   2) enqueue без Google-з'єднання → операція збережена, черга переживає розрив;
   3) reload/перезапуск процесу → pending-операція виживає;
   4) flush до ticketsLoaded → без видалення/TICKET_LOOKUP_MISSING/спалювання спроб;
   5) після ticketsLoaded → операція може відправитись;
   6) реально відсутня заявка після ready → TICKET_LOOKUP_MISSING;
   12) GAS v7 (report_status без id_set_hash) → REPORT_GAS_UPGRADE_REQUIRED, не
   REPORT_ARCHIVE_MISMATCH; наявний неправильний id_set_hash → REPORT_ARCHIVE_MISMATCH;
   13) телеметрія не містить приватних даних заявки.
   Плюс явний виклик enqueue у ticket-editor-domain.js з телеметрією (завдання 6). */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');

function makeStorage(){const m=new Map();return{getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}
function loadClient(){
  const storage=makeStorage();
  const ctx={globalThis:{localStorage:storage},URL,setTimeout,clearTimeout};
  vm.runInNewContext(read('js/dispatcher-telemetry.js'),ctx,{filename:'js/dispatcher-telemetry.js'});
  vm.runInNewContext(read('js/dispatcher-report-client.js'),ctx,{filename:'js/dispatcher-report-client.js'});
  return {client:ctx.globalThis.MTDispatcherReportClient,telemetry:ctx.globalThis.MTDispatcherTelemetry,ctx,storage};
}
function harness(opts={}){
  const {client,telemetry,ctx,storage}=loadClient();
  let raw=null,clock=1000;const calls=[],timers=[];
  const config={dispatcherReportEndpoint:opts.endpoint===undefined?'https://script.google.com/macros/s/test/exec':opts.endpoint,dispatcherReportEnabled:opts.enabled!==false};
  const tickets=opts.tickets||[{id:'t-1'}];
  const deps={
    storage:{getItem:()=>raw,setItem:(_k,v)=>{raw=v;}},settings:()=>config,
    tickets:()=>tickets,ticket:id=>tickets.find(t=>t.id===id)||null,
    dto:async(t,v)=>({ticket_id:t.id,source_version:v}),
    now:()=>++clock,requestId:()=>crypto.randomUUID(),online:()=>true,
    setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout:()=>{},
    send:opts.send||(async(_u,r)=>{calls.push(r);return {ok:true,inserted:r.tickets.length,updated:0,unchanged:0,deleted:r.deletes.length,rejected:0,errors:0};}),
    storeReady:opts.storeReady
  };
  const q=client.createOutbox(deps);
  return {q,deps,config,timers,calls,raw:()=>raw?JSON.parse(raw):null,telemetry,storage,ctx,reboot:()=>client.createOutbox(deps)};
}

(async()=>{
  // 1) auto-send OFF: операція персиститься, планувальник і відправка мовчать.
  {
    const h=harness({enabled:false});
    assert.equal(h.q.enqueueUpsert({id:'t-off'}),true,'enqueue must persist with auto-send OFF');
    const meta=h.raw();
    assert.equal(meta.operations.length,1,'operation persisted with the ticket ID');
    assert.equal(meta.operations[0].id,'t-off');
    assert.equal(meta.operations[0].error,'','no permanent error is attached');
    assert.equal(h.timers.length,0,'auto-send must not schedule');
    assert.equal(h.calls.length,0,'auto-send must not execute');
    assert.equal(h.q.delivery('t-off').state,'pending','op is pending, not disabled/dropped');
    const events=h.telemetry.dump();
    assert.ok(events.some(e=>e.event==='operation_persisted'),'enqueue telemetry: operation_persisted');
    assert.ok(events.some(e=>e.event==='enqueue_result'&&e.code==='QUEUED'),'enqueue telemetry: enqueue_result QUEUED');
  }
  // 2) без Google-з'єднання: операція збережена і не спалює спроби.
  {
    const h=harness({tickets:[{id:'t-conn'}],send:async()=>{throw new Error('GOOGLE_CONNECTION_REQUIRED');}});
    h.q.enqueueUpsert({id:'t-conn'});
    await h.q.flush();
    const meta=h.raw();
    assert.equal(meta.operations.length,1,'connection loss keeps the operation');
    assert.equal(meta.operations[0].id,'t-conn');
    assert.equal(meta.operations[0].attempts,0,'consent failures do not burn attempts');
    assert.equal(h.q.status().connectionRequired,true);
    h.deps.send=async(_u,r)=>{h.calls.push(r);return {ok:true,inserted:r.tickets.length,updated:0,unchanged:0,deleted:r.deletes.length,rejected:0,errors:0};};
    h.q.connectionReady();
    await h.q.flush();
    assert.equal(h.q.status().pending,0,'pending op sends after the connection returns');
    assert.equal(h.calls.length,1);
  }
  // 3) reload/перезапуск процесу: pending-операція виживає.
  {
    const h=harness({tickets:[{id:'t-reload'}]});
    h.q.enqueueUpsert({id:'t-reload'});
    const restored=h.reboot();
    assert.equal(restored.status().pending,1,'pending operation survives reload');
    assert.equal(restored.delivery('t-reload').state,'pending');
    assert.equal(h.raw().operations[0].id,'t-reload');
    await restored.flush();
    assert.equal(restored.status().pending,0);
    assert.equal(restored.delivery('t-reload').state,'sent');
  }
  // 4) flush до готовності сховища: жодних втрат/помилок/спалювання спроб.
  {
    let ready=false;
    const h=harness({tickets:[{id:'t-store'}],storeReady:()=>ready});
    h.q.enqueueUpsert({id:'t-store'});
    await h.q.flush();
    let meta=h.raw();
    assert.equal(meta.operations.length,1,'not-ready flush must not delete the op');
    assert.equal(meta.operations[0].id,'t-store');
    assert.equal(meta.operations[0].attempts,0,'not-ready flush must not burn attempts');
    assert.equal(meta.operations[0].error,'','not-ready flush must not set TICKET_LOOKUP_MISSING');
    assert.equal(h.q.status().pending,1,'op stays pending');
    assert.equal(h.calls.length,0,'nothing is sent before the store is ready');
    await assert.rejects(h.q.syncAll(),/REPORT_STORE_NOT_READY/,'manual sync fails with an explicit code instead of hanging');
    assert.ok(h.telemetry.dump().some(e=>e.event==='store_not_ready'),'store_not_ready is recorded');
    // 5) після ticketsLoaded — операція відправляється.
    ready=true;
    await h.q.flush();
    assert.equal(h.q.status().pending,0,'after ticketsLoaded the op sends');
    assert.equal(h.calls.length,1);
  }
  // 6) реально відсутня заявка ПІСЛЯ ready → TICKET_LOOKUP_MISSING.
  {
    const h=harness({tickets:[]});
    h.q.enqueueUpsert({id:'t-missing'});
    await h.q.flush();
    const meta=h.raw();
    assert.equal(meta.operations[0].error,'TICKET_LOOKUP_MISSING','genuinely missing ticket after ready is classified');
    assert.equal(meta.diagnostics.length,1);
    assert.equal(meta.diagnostics[0].reason,'TICKET_LOOKUP_MISSING');
    assert.ok(h.telemetry.dump().some(e=>e.event==='lookup_miss'),'lookup_miss is recorded');
  }
  // 12) GAS-сумісність: v7 report_status без id_set_hash ≠ archive mismatch.
  {
    const h=harness({tickets:[{id:'t-gas'}]});
    await h.q.syncAll();
    const gasV7={ok:true,active_count:1,deleted_count:0,earliest_date:'2026-10-09',latest_date:'2026-10-09'};
    let code='';
    try{h.q.confirmArchive(gasV7,'a'.repeat(64),1);}catch(e){code=e.message;}
    assert.equal(code,'REPORT_GAS_UPGRADE_REQUIRED','missing id_set_hash is a contract-version gap');
    assert.notEqual(code,'REPORT_ARCHIVE_MISMATCH');
    let mismatch='';
    try{h.q.confirmArchive({...gasV7,id_set_hash:'0'.repeat(64)},'a'.repeat(64),1);}catch(e){mismatch=e.message;}
    assert.equal(mismatch,'REPORT_ARCHIVE_MISMATCH','present-but-wrong id_set_hash keeps the old code');
  }
  // 13) приватність телеметрії: whitelist-поля, без приватних даних.
  {
    const h=harness();
    h.telemetry.record('ticket_saved',{phone:'PRIVATE-CANARY-097',name:'PRIVATE-NAME',address:'PRIVATE-ADDRESS',mac:'AA:BB:CC:DD:EE:FF',note:'PRIVATE-NOTE',content:'PRIVATE-CONTENT',ticket_id:'secret-ticket-id',endpoint:'https://secret.example/exec',credentials:'PRIVATE-CRED',code:'QUEUED',pending:3,store_ready:true});
    const last=h.telemetry.dump().at(-1);
    assert.equal(last.event,'ticket_saved');
    assert.equal(last.code,'QUEUED');
    assert.equal(last.pending,3);
    assert.equal(last.store_ready,true);
    for(const field of ['phone','name','address','mac','note','content','ticket_id','endpoint','credentials'])assert.ok(!(field in last),'field '+field+' must be dropped');
    let json=JSON.stringify(h.telemetry.dump());
    for(const secret of ['PRIVATE-CANARY-097','PRIVATE-NAME','PRIVATE-ADDRESS','AA:BB:CC:DD:EE:FF','PRIVATE-NOTE','PRIVATE-CONTENT','secret-ticket-id','PRIVATE-CRED','https://secret.example'])assert.ok(!json.includes(secret),secret+' must never reach the buffer');
    // довільний текст у code не проходить whitelist-санітизацію
    h.telemetry.record('send_result',{code:'lowercase free text with spaces'});
    assert.ok(!('code' in h.telemetry.dump().at(-1)),'free-text code is dropped');
    // невідомі події відхиляються
    assert.equal(h.telemetry.record('evil_event',{code:'X'}),false);
    // кільце обмежене 200 подіями
    for(let i=0;i<250;i++)h.telemetry.record('send_attempt',{batch_size:i});
    assert.equal(h.telemetry.dump().length,200,'ring buffer is capped at 200');
  }
  // 6b) явний виклик enqueue у ticket-editor-domain.js: телеметрія + модуль-діагностика.
  {
    const editor=read('js/ticket-editor-domain.js');
    assert.ok(editor.includes('globalThis.MTDispatcherReport.enqueueUpsert(savedTicketRef)'),'enqueue call is explicit');
    assert.ok(editor.includes("'ticket_saved'")&&editor.includes("'enqueue_attempt'"),'save telemetry is wired');
    assert.ok(editor.includes("'REPORT_MODULE_UNAVAILABLE'"),'missing module is a first-class diagnostic');
    assert.ok(editor.includes('enqueue_result'),'enqueue_result telemetry is wired');
    // локальне збереження і legacy-синхронізація не зламані
    assert.ok(editor.includes('await saveTickets()'),'durable local save stays first');
    assert.ok(editor.includes('recordDiff'),'legacy Google flush trigger remains in the save path');
    assert.ok(editor.indexOf('await saveTickets()')<editor.indexOf('enqueueUpsert(savedTicketRef)'),'enqueue happens only AFTER durable local save');
    assert.ok(editor.indexOf('if(!localSaved)')<editor.indexOf('enqueueUpsert(savedTicketRef)'),'failed local save never reaches the enqueue block');
  }
  console.log('PASS durable enqueue (disabled/no-connection/reload), store-ready gate, missing lookup after ready, GAS v7 upgrade detection, telemetry privacy');
})().catch(e=>{console.error(e);process.exitCode=1;});
