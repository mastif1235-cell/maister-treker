'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync('js/dispatcher-report-client.js','utf8');
const URL1='https://script.google.com/macros/s/synthetic/exec';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
  let raw=null,clock=1000,request=0;
  const config={dispatcherReportEnabled:true,dispatcherReportEndpoint:URL1,dispatcherHmacSecret:'synthetic-secret-01234567890123456789'},calls=[],timers=new Map();
  const ctx={URL,crypto:crypto.webcrypto,AbortController,setTimeout,clearTimeout};vm.runInNewContext(source,ctx);
  const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>raw=v},settings:()=>config,now:()=>++clock,requestId:()=>'audit-request-'+(++request),ticket:id=>({id}),tickets:()=>[],dto:async(t,v)=>({ticket_id:t.id,source_version:v}),setTimeout:fn=>{timers.set(++clock,fn);return clock;},clearTimeout:id=>timers.delete(id),send:async(_u,r)=>{calls.push(r);return {ok:true,items:[...r.tickets.map(o=>({...o,action:'upsert'})),...r.deletes.map(o=>({...o,action:'delete'}))].map(o=>({ticket_id:o.ticket_id,source_version:o.source_version,action:o.action,status:'synced',code:'OK'}))};}};
  return {ctx,config,calls,deps,timers,q:ctx.MTDispatcherReportClient.createOutbox(deps),raw:()=>JSON.parse(raw),seed:x=>raw=JSON.stringify(x)};
}
(async()=>{
  // Exercise the REAL signing adapter, not a replacement for its async path.
  for(const change of ['off','endpoint','secret','supersede','rapid-toggle']){
    const h=harness(),entered=deferred(),release=deferred();let posts=0;
    h.ctx.MTSyncTransport={signedEnvelope:async()=>{entered.resolve();await release.promise;return {};}};
    h.deps.send=h.ctx.MTDispatcherReportClient.createDirectSend({settings:()=>h.config,fetch:async()=>{posts++;return {json:async()=>({ok:true})};}});
    h.q.enqueueDelete('race');const flight=h.q.flush({reason:'auto'});await entered.promise;
    if(change==='off')h.config.dispatcherReportEnabled=false;
    if(change==='endpoint')h.config.dispatcherReportEndpoint=URL1.replace('synthetic','changed');
    if(change==='secret')h.config.dispatcherHmacSecret+='changed';
    if(change==='supersede')h.q.enqueueDelete('race');
    if(change==='rapid-toggle'){h.config.dispatcherReportEnabled=false;h.q.reconfigure();h.config.dispatcherReportEnabled=true;h.q.reconfigure();}
    release.resolve();await flight;
    assert.equal(posts,0,change+' revokes old signing capability');assert.equal(h.q.status().unresolved,1);assert.equal(h.raw().operations[0].attempts,0);assert.equal(h.raw().operations[0].error,'');
  }
  // OFF after a rejected cached request must prohibit a fresh-ID second POST.
  {
    const h=harness();h.q.enqueueDelete('a');h.deps.send=async()=>{throw Error('GOOGLE_CONNECTION_REQUIRED');};await h.q.flush();h.q.connectionReady();
    let calls=0;h.deps.send=async()=>{calls++;h.config.dispatcherReportEnabled=false;return {ok:false,code:'INVALID_REQUEST_ID'};};
    await h.q.flush({reason:'auto'});assert.equal(calls,1);assert.equal(h.q.status().unresolved,1);assert.equal(h.raw().operations[0].attempts,0);
  }
  // Concurrent manual intents are serialized, never swallowed by one flight.
  {
    const h=harness();h.config.dispatcherReportEnabled=false;for(const id of ['a','b','neighbor'])h.q.enqueueDelete(id);
    await Promise.all([h.q.retry('a'),h.q.retry('b')]);assert.deepEqual(h.calls.map(r=>Array.from(r.deletes,d=>d.ticket_id)),[['a'],['b']]);
    assert(h.calls.every(r=>r.rebuild),'each scoped final batch updates the visible report even with unrelated pending');
    assert.equal(h.q.delivery('neighbor').state,'pending');assert.equal(h.q.status().unresolved,1);
  }
  // AUTO enqueue during MANUAL flight is recovered without duplicate POSTs.
  {
    const h=harness(),release=deferred(),entered=deferred(),send=h.deps.send;
    h.q.enqueueDelete('a');h.deps.send=async(u,r)=>{entered.resolve();await release.promise;return send(u,r);};
    const first=h.q.retry('a');await entered.promise;h.q.enqueueDelete('b');const joined=h.q.flush({reason:'auto'});release.resolve();await Promise.all([first,joined]);
    const tasks=[...h.timers.values()];h.timers.clear();for(const fn of tasks)fn();await h.q.flush({reason:'auto'});
    assert.equal(h.calls.length,2);assert.equal(h.q.status().unresolved,0);
  }
  // Missing counters are not a receipt, either live or reconciled.
  {
    const h=harness();h.config.dispatcherReportEnabled=false;h.q.enqueueDelete('a');h.deps.send=async()=>({ok:true});await h.q.flush();
    assert.equal(h.q.status().unresolved,1);assert.equal(h.q.status().lastError,'REPORT_PARTIAL_ACK');
    assert.equal(h.q.reconcile({request_id:h.raw().inflight.request_id},{ok:true}),false);assert.equal(h.raw().receipts.length,0);
  }
  // Durable queue failure prohibits a network mutation; recovery preserves ID.
  {
    const h=harness();h.deps.storage.setItem=()=>{throw Error('quota');};h.q.enqueueDelete('a');await h.q.flush();assert.equal(h.calls.length,0);assert.equal(h.q.status().unresolved,1);
  }
  console.log('PASS audit races: signing/OFF/config/supersession, fresh-ID fallback, concurrent intents, scoped render, strict ACK, durable-before-send');
})().catch(e=>{console.error(e);process.exitCode=1;});
