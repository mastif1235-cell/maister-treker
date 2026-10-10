'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const cache=new Map(),properties=new Map([['REPORT_SPREADSHEET_ID','synthetic-report'],['REPORT_ALLOWED_EMAIL','owner@example.invalid'],['REPORT_ALLOWED_ORIGINS','https://example.invalid']]);
let rows=[],writes=0;
const c={Date,Map,Set,JSON,URL,console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k)||'',setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]}};
vm.createContext(c);
for(const f of ['js/dispatcher-report-core.js','gas/dispatcher-report/DispatcherReport.gs','js/dispatcher-report-client.js'])vm.runInContext(fs.readFileSync(f,'utf8'),c);
c.reportStore_=()=>({rows:structuredClone(rows),ss:{}});c.reportWrite_=s=>{rows=structuredClone(s.rows);writes++;};c.reportRender_=()=>{};
function dto(id,v,note=''){
  const d=Object.fromEntries(c.MTDispatcherReportCore.FIELDS.map(k=>[k,'']));
  Object.assign(d,{ticket_id:id,work_date:'2026-10-10',work_time:'21:36',work_type:'Ремонт',work_category:'repair',amount:0,total:0,onu_used:0,onu_replacement:0,router_used:0,payment_cash:0,payment_cashless:0,payment_free_amount:0,payment_free_count:1,updated_at:'2026-10-10T00:00:00.000Z',source_version:v,dispatcher_comment:note});
  d.source_hash=c.reportHash_(d);return d;
}
let rid=0,raw=null,clock=1000,mode='',lastRequest,lastResponse;
const tickets=[{id:'stale'},{id:'valid-2650'},{id:'valid-third'}];
const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>{raw=v;}},settings:()=>({dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',dispatcherReportEnabled:false}),ticket:id=>tickets.find(t=>t.id===id),tickets:()=>tickets,now:()=>clock,requestId:()=>'request-'+(++rid),setTimeout:()=>1,clearTimeout:()=>{},dto:async(t,v)=>dto(t.id,v),send:async(_u,r)=>{
  lastRequest=r;if(mode==='unavailable')throw new Error('REPORT_NETWORK_ERROR');
  lastResponse=c.reportExecute_(c.reportConfig_(),r);
  if(mode==='lost'){mode='';throw new Error('GOOGLE_CONNECTION_REQUIRED');}return lastResponse;
}};
function reset(){rows=[];writes=0;cache.clear();raw=null;clock=1000;mode='';return c.MTDispatcherReportClient.createOutbox(deps);}
function read(){return JSON.parse(raw);}
(async()=>{
  let q=reset();rows=[{...dto('stale',1000,'different hash'),deleted_at:'',sync_status:'SYNCED'}];
  for(const t of tickets)q.enqueueUpsert(t);
  await q.flush();
  assert.equal(rows.length,3,'stale sibling must not prevent either valid insert');
  assert.equal(rows[0].dispatcher_comment,'different hash','stale NEVER overwrites');
  assert.equal(q.delivery('stale').code,'STALE_VERSION');
  for(const id of ['valid-2650','valid-third'])assert.equal(q.delivery(id).state,'sent');
  assert.equal(q.status().failed,1);assert.equal(q.status().unresolved,1);
  assert.equal(read().receipts.length,2);assert.equal(lastResponse.items.length,3);
  assert.equal(lastResponse.items[0].status,'stale_version');
  const replayWrites=writes;
  assert.equal(c.reportExecute_(c.reportConfig_(),lastRequest).items.length,3);assert.equal(writes,replayWrites,'cached partial ACK does not mutate twice');
  q.retry('valid-2650');await q.flush();assert.equal(rows.length,3);assert.equal(q.delivery('stale').code,'STALE_VERSION');
  // Only the explicitly corrected conflict gets a higher version; retry does
  // not itself overwrite or bump any version, nor reset unrelated operations.
  clock++;q.enqueueUpsert({id:'stale'});await q.flush();assert.equal(q.status().unresolved,0);assert.equal(rows.length,3);
  let r=c.reportExecute_(c.reportConfig_(),{action:'report_upsert',ticket:dto('valid-2650',1000),request_id:'same-hash-test'});
  assert.equal(r.items[0].status,'unchanged');
  r=c.reportExecute_(c.reportConfig_(),{action:'report_upsert',ticket:dto('valid-2650',1000,'changed'),request_id:'different-hash-test'});
  assert.equal(r.items[0].code,'STALE_VERSION');
  r=c.reportExecute_(c.reportConfig_(),{action:'report_sync_all',tickets:[{...dto('invalid',1001),phone:'PRIVATE-CANARY'},dto('valid-fourth',1001)],request_id:'invalid-item-test'});
  assert.equal(r.items[0].status,'invalid_dto');assert.equal(r.items[1].status,'synced');assert(!JSON.stringify(r).includes('PRIVATE-CANARY'));
  // Lost partial ACK, including reload, is reconciled per item, no resend.
  q=reset();rows=[{...dto('stale',1000,'different hash'),deleted_at:'',sync_status:'SYNCED'}];
  for(const t of tickets)q.enqueueUpsert(t);mode='lost';await q.flush();
  assert.equal(q.status().unresolved,3);assert.equal(rows.length,3);
  q=c.MTDispatcherReportClient.createOutbox(deps);
  assert(q.reconcile(lastRequest,lastResponse));assert.equal(q.status().unresolved,1);assert.equal(read().receipts.length,2);
  assert.equal(q.delivery('stale').code,'STALE_VERSION');assert.equal(writes,1);
  // A late rejected ACK after exhausting transport attempts stays reload-safe.
  q=reset();rows=[{...dto('stale',1000,'different hash'),deleted_at:'',sync_status:'SYNCED'}];
  q.enqueueUpsert(tickets[0]);mode='lost';await q.flush();
  const saved=read();saved.operations[0].attempts=3;saved.lastError='REPORT_NETWORK_ERROR';raw=JSON.stringify(saved);
  q=c.MTDispatcherReportClient.createOutbox(deps);assert(q.reconcile(lastRequest,lastResponse));
  assert.equal(read().operations[0].attempts,3);q=c.MTDispatcherReportClient.createOutbox(deps);assert.equal(q.status().unresolved,1);assert.equal(q.delivery('stale').code,'STALE_VERSION');
  // Unavailable GAS never confirms or removes an op; recovery is duplicate-safe.
  q=reset();q.enqueueUpsert(tickets[1]);mode='unavailable';await q.flush();assert.equal(q.status().unresolved,1);assert.equal(rows.length,0);
  mode='';clock+=6000;await q.flush();assert.equal(q.delivery(tickets[1].id).state,'sent');assert.equal(rows.length,1);
  // Historical invalid DTO remains untouched by targeted OR general retry.
  raw=JSON.stringify({operations:[{id:'historical',action:'upsert',version:1,attempts:0,error:'INVALID_DTO'}, {id:'valid-2650',action:'upsert',version:1000,attempts:1,error:'STALE_VERSION'}]});
  q=c.MTDispatcherReportClient.createOutbox(deps);q.retry('valid-2650');assert.equal(read().operations[0].error,'INVALID_DTO');await q.flush();assert.equal(q.delivery('valid-2650').state,'sent');assert.equal(q.status().failed,1);
  q.retry();assert.equal(read().operations[0].error,'INVALID_DTO');
  // Original Android situation: all three were labelled STALE by the old
  // client. Targeted retries clear ONLY the two absent-server operations.
  rows=[{...dto('stale',1000,'different hash'),deleted_at:'',sync_status:'SYNCED'}];cache.clear();
  raw=JSON.stringify({operations:[{id:'historical',action:'upsert',version:1,attempts:0,error:'INVALID_DTO'},...tickets.map(t=>({id:t.id,action:'upsert',version:1000,attempts:1,error:'STALE_VERSION'}))]});
  q=c.MTDispatcherReportClient.createOutbox(deps);q.retry('valid-2650');q.retry('valid-third');await q.flush();
  assert.equal(rows.length,3);assert.equal(q.delivery('valid-2650').state,'sent');assert.equal(q.delivery('valid-third').state,'sent');assert.equal(q.delivery('stale').code,'STALE_VERSION');assert.equal(q.delivery('historical').code,'INVALID_DTO');
  assert.deepEqual(read().operations.map(o=>[o.id,o.attempts]),[['historical',0],['stale',1]]);
  // Full-sync counters account for successes ONLY; partial never means PASS.
  q=reset();rows=[{...dto('stale',1000,'different hash'),deleted_at:'',sync_status:'SYNCED'}];
  q.fullSync();await q.flush();const progress=q.status().sync;
  assert.equal(progress.expected_count,3);assert.equal(progress.received_ack_count,2);assert.equal(progress.failed_count,1);assert.equal(progress.unresolved_count,1);assert.notEqual(progress.final_validation,'PASS');
  // Forged, duplicate or incomplete identities cannot clear even one op.
  q=reset();for(const t of tickets)q.enqueueUpsert(t);
  const send=deps.send;deps.send=async()=>({ok:true,items:Array(3).fill({ticket_id:'valid-2650',action:'upsert',source_version:1000,status:'synced',code:'OK'})});
  await q.flush();assert.equal(q.status().unresolved,3);assert.equal(read().receipts.length,0);deps.send=send;
  console.log('Dispatcher per-item server/client: PASS (partial failure, retry, lost ACK/reload, unavailable/recovery, duplicate safety, privacy, historical isolation)');
})().catch(e=>{console.error(e);process.exitCode=1;});
