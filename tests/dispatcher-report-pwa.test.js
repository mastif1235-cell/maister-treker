'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/dispatcher-report-client.js','utf8');
const ctx={globalThis:{},URL,setTimeout,clearTimeout};vm.runInNewContext(source,ctx);
const factory=ctx.globalThis.MTDispatcherReportClient.createOutbox;
const endpoint='https://script.google.com/macros/s/synthetic/exec',key='mtDispatcherReportOutboxV1';
function harness(seed){
  let raw=seed?JSON.stringify(seed):null,time=10,sendCount=0;
  const config={dispatcherReportEndpoint:endpoint,dispatcherReportEnabled:true};
  const tickets=Array.from({length:430},(_,i)=>({id:'test-'+i,masterNote:'PRIVATE-CANARY'}));
  const changes=[],timers=[];
  const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>{raw=v;}},settings:()=>config,tickets:()=>tickets,ticket:id=>tickets.find(t=>t.id===id),dto:async(t,v)=>({ticket_id:t.id,source_version:v}),send:async()=>{sendCount++;throw new Error('GOOGLE_CONNECTION_REQUIRED');},requestId:()=> 'test-request-id',now:()=>time,setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout:()=>{},changed:x=>changes.push(x)};
  const q=factory(deps);return{q,deps,config,tickets,changes,timers,raw:()=>raw,count:()=>sendCount,tick:()=>{time+=180000;}};
}
(async()=>{
  const h=harness();h.q.fullSync();await h.q.flush();
  assert.equal(h.count(),1);assert.equal(h.q.status().pending,430);assert.equal(h.q.status().failed,0);assert.equal(h.q.status().connectionRequired,true);
  for(let i=0;i<20;i++){h.tick();await h.q.flush();}assert.equal(h.count(),1,'no 430-item authentication retry storm');
  assert.equal(h.q.status().running,false);assert(!h.raw().includes('PRIVATE-CANARY'));assert(JSON.parse(h.raw()).operations.every(o=>o.attempts===0));
  const migrated=harness({endpoint,operations:JSON.parse(h.raw()).operations.map(o=>({...o,attempts:3})),lastError:'GOOGLE_CONNECTION_REQUIRED'});
  assert.equal(migrated.q.status().pending,430);assert.equal(migrated.q.status().failed,0);assert.equal(migrated.q.status().connectionRequired,true);
  h.deps.send=async()=>({ok:true});h.q.connectionReady();await h.q.flush();
  assert.equal(h.q.delivery('test-0').state,'sent');assert.equal(h.q.delivery('test-51').state,'pending');
  const reload=harness(JSON.parse(h.raw()));assert.equal(reload.q.delivery('test-0').state,'sent');
  h.q.enqueueUpsert(h.tickets[0]);assert.equal(h.q.delivery('test-0').state,'pending');
  h.config.dispatcherReportEnabled=false;assert.equal(h.q.delivery('not-delivered').state,'disabled');
  h.q.fullSync();await h.q.flush();assert.equal(h.q.delivery('test-0').state,'sent','manual sync works with auto-send OFF');
  h.config.dispatcherReportEndpoint='';assert.equal(h.q.delivery('test-0').state,'not_configured');
  const concurrent=harness();let finish,started;const startPromise=new Promise(resolve=>{started=resolve;});concurrent.deps.send=()=>new Promise(resolve=>{finish=resolve;started();});
  concurrent.q.enqueueUpsert(concurrent.tickets[0]);const sending=concurrent.q.flush();await startPromise;
  concurrent.tick();concurrent.q.enqueueUpsert(concurrent.tickets[0]);finish({ok:true});await sending;
  assert.equal(concurrent.q.delivery('test-0').state,'pending','old ACK cannot confirm newer edit');
  const failure=harness();failure.deps.send=async()=>({ok:false,code:'REPORT_NETWORK_ERROR'});failure.q.enqueueUpsert(failure.tickets[0]);for(let i=0;i<4;i++){failure.tick();await failure.q.flush();}
  assert.equal(failure.q.status().failed,1);assert.equal(failure.q.delivery('test-0').state,'error');assert.equal(failure.q.status().running,false);
  assert(source.includes("window.addEventListener('focus',resume)"));assert(source.includes("window.addEventListener('pageshow',resume)"));assert(source.includes("document.addEventListener('visibilitychange'"));assert(!source.includes("addEventListener('pagehide',"),'no connection reset on Android app switch');
  assert(source.includes('finally{activeActions.delete(action);button.disabled=false;button.removeAttribute'));
  // One presentation boundary for full and compact cards; old canonical ACK
  // does not influence dispatcher receipts, and no ticket schema fields added.
  const render=fs.readFileSync('js/tickets-render.js','utf8');assert(render.includes('const syncBadge = ticketDeliveryBadges(t)'));assert(fs.readFileSync('js/tickets-compact-view.js','utf8').includes('ticketDeliveryBadges(ticket)'));
  const start=render.indexOf('function ticketDeliveryBadges'),end=render.indexOf('function renderDateNavVisibility');
  const view={getScriptUrl:()=>endpoint,getEntityConflict:()=>null,isEntitySynced:()=>true,escapeHtml:x=>String(x),globalThis:{MTDispatcherReport:{delivery:()=>({state:'error',code:'GOOGLE_CONNECTION_REQUIRED'}),badge:()=> '📊 Таблиця Д: ❌ Помилка'}}};
  vm.runInNewContext(render.slice(start,end)+';result=ticketDeliveryBadges({id:"a"});',view);assert(view.result.includes('Стара таблиця: ✅ Надіслано'));assert(view.result.includes('Таблиця Д: ❌ Помилка'));
  console.log('Dispatcher Android-resume / 430-queue recovery / per-ticket receipts / manual sync / stale ACK / UI settlement: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
