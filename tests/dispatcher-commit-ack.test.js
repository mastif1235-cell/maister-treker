'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(p,'utf8');
function harness(){
  let rows=[],writes=0,renders=0,writeFails=false,renderFails=false,raw=null,seq=0;
  const cache=new Map(),properties=new Map([['REPORT_SPREADSHEET_ID','synthetic'],['REPORT_ALLOWED_EMAIL','test@example.invalid'],['REPORT_ALLOWED_ORIGINS','https://example.invalid']]);
  const c={Date,Map,Set,JSON,URL,console:{warn:()=>{}},PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k)||'',setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)})},CacheService:{getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})},Utilities:{DigestAlgorithm:{SHA_256:1},Charset:{UTF_8:1},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()]}};
  vm.createContext(c);for(const p of ['js/dispatcher-report-core.js','gas/dispatcher-report/DispatcherReport.gs','js/dispatcher-report-client.js'])vm.runInContext(read(p),c);
  c.reportStore_=()=>({rows:structuredClone(rows)});
  c.reportWrite_=store=>{if(writeFails)throw Error('synthetic write failure');rows=structuredClone(store.rows);writes++;};
  c.reportRender_=()=>{if(renderFails)throw Error('PRIVATE-CANARY render failure');renders++;};
  const journal=require('./helpers/dispatcher-receipt-sheet.cjs')(c);
  function dto(id,v=1000,note=''){const d=Object.fromEntries(c.MTDispatcherReportCore.FIELDS.map(k=>[k,'']));Object.assign(d,{ticket_id:id,source_version:v,work_date:'2026-10-11',work_time:'10:29',work_type:'Інше',work_category:'other',amount:0,total:0,onu_used:0,onu_replacement:0,router_used:0,payment_cash:0,payment_cashless:0,payment_free_amount:0,payment_free_count:1,updated_at:'2026-10-11T00:00:00.000Z',dispatcher_comment:note});d.source_hash=c.reportHash_(d);return d;}
  const execute=request=>c.reportExecute_(c.reportConfig_(),request);
  const request=(tickets,id='synthetic-'+(++seq))=>({action:'report_sync_all',tickets,request_id:id});
  const tickets=[{id:'orphan'},{id:'neighbor'}],config={dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',dispatcherReportEnabled:false};
  const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>raw=v},settings:()=>config,ticket:id=>tickets.find(t=>t.id===id),tickets:()=>tickets,now:()=>1000,requestId:()=>'client-request-'+(++seq),setTimeout:()=>1,clearTimeout:()=>{},dto:async(t,v)=>dto(t.id,v),send:async(_url,r)=>execute(r)};
  return {c,cache,properties,journal,dto,execute,request,deps,config,tickets,rows:()=>rows,writes:()=>writes,renders:()=>renders,writeFailure:v=>writeFails=v,renderFailure:v=>renderFails=v,seed:v=>raw=JSON.stringify(v),raw:()=>JSON.parse(raw),q:()=>c.MTDispatcherReportClient.createOutbox(deps)};
}
(async()=>{
  const replayDenied=harness();replayDenied.c.reportConsumeNonce_=()=>false;
  assert.throws(()=>replayDenied.c.reportExecute_(replayDenied.c.reportConfig_(),replayDenied.request([replayDenied.dto('denied')]),'reused-nonce'),/AUTH_FAILED/);
  assert.equal(replayDenied.journal.sheets.size,0,'nonce rejection cannot even create receipt metadata');assert.equal(replayDenied.writes(),0);
  // A/B: successful data commit is independent of render; durable replay
  // survives cache eviction and never calls the mutation writer again.
  const h=harness();h.renderFailure(true);
  const req=h.request([h.dto('a'),h.dto('b')]);
  const first=h.execute(req);assert.equal(first.ok,true);assert.deepEqual(Array.from(first.items,i=>i.status),['synced','synced']);assert.equal(h.writes(),1);assert.equal(h.rows().length,2);
  assert.equal(h.properties.get('REPORT_LAST_ERROR'),'REPORT_RENDER_FAILED');
  h.cache.clear();const replay=h.execute(req);assert.equal(JSON.stringify(replay),JSON.stringify(first));assert.equal(h.writes(),1);
  assert.throws(()=>h.execute({...req,tickets:[h.dto('different')]}),/INVALID_REQUEST_ID/);
  assert.equal(h.rows().length,new Set(h.rows().map(r=>r.ticket_id)).size);
  // C: failed write never obtains a success ACK, including after cache loss.
  const fail=harness();fail.writeFailure(true);const failed=fail.request([fail.dto('c')]);
  assert.throws(()=>fail.execute(failed),/synthetic write failure/);assert.equal(fail.rows().length,0);assert(!fail.cache.has('REPORT_ACK_'+failed.request_id));
  assert.throws(()=>fail.execute(failed),/synthetic write failure/);
  const fq=fail.q();fq.enqueueUpsert({id:'orphan'});await fq.flush();assert.equal(fq.status().unresolved,1);assert.equal(fail.raw().receipts.length,0);
  fail.writeFailure(false);assert.equal(fail.execute(failed).items[0].status,'synced');assert.equal(fail.rows().length,1);assert.equal(fail.writes(),1);
  fail.cache.clear();assert.equal(fail.execute(failed).items[0].status,'synced');assert.equal(fail.writes(),1);
  const conflict=harness();conflict.writeFailure(true);const pending=conflict.request([conflict.dto('conflict')]);
  assert.throws(()=>conflict.execute(pending));conflict.writeFailure(false);
  assert.throws(()=>conflict.execute(conflict.request([conflict.dto('neighbor')])),/REPORT_COMMIT_UNRESOLVED/,'new mutations cannot cross unresolved commit evidence');
  conflict.rows().push({...conflict.dto('conflict',1001,'newer'),deleted_at:'',sync_status:'SYNCED'}); // simulate an external change, never overwrite it
  const conflictWrites=conflict.writes();assert.throws(()=>conflict.execute(pending),/REPORT_COMMIT_UNRESOLVED/);assert.equal(conflict.writes(),conflictWrites);assert.equal(conflict.rows()[0].dispatcher_comment,'newer');
  // D: exact partial results remain unchanged when presentation fails.
  const mixed=harness();mixed.execute(mixed.request([mixed.dto('stale',1000,'old')]));mixed.renderFailure(true);
  const partial=mixed.execute(mixed.request([mixed.dto('stale',1000,'new'),mixed.dto('good'),{...mixed.dto('bad'),phone:'PRIVATE-CANARY'}]));
  assert.equal(partial.code,'PARTIAL');assert.deepEqual(Array.from(partial.items,i=>i.status),['stale_version','synced','invalid_dto']);assert.equal(mixed.rows().length,2);assert.equal(mixed.rows()[0].dispatcher_comment,'old');
  assert(!JSON.stringify(partial).includes('PRIVATE-CANARY'));
  // E: a subsequent successful rebuild restores presentation only.
  h.renderFailure(false);const oldWrites=h.writes();assert(h.execute({action:'report_rebuild',request_id:'rebuild-next'}).ok);assert.equal(h.renders(),1);assert.equal(h.writes(),oldWrites);
  // F: real server engine -> lost response -> reload -> same request durable
  // ACK -> client completeSent, no second data write, zero duplicates.
  const lost=harness();let drop=true;const send=lost.deps.send;
  lost.deps.send=async(...args)=>{const r=await send(...args);if(drop){drop=false;throw Error('REPORT_CONNECTION_RESET');}return r;};
  let q=lost.q();q.enqueueUpsert({id:'orphan'});await q.flush();assert.equal(q.status().unresolved,1);assert.equal(lost.rows().length,1);
  lost.cache.clear();q=lost.q();q.connectionReady();await q.flush();assert.equal(q.delivery('orphan').state,'sent');assert.equal(q.status().unresolved,0);assert.equal(lost.writes(),1);
  // Crash between data flush and COMMITTED marker: PREPARED evidence recovers
  // exact original result, rather than inventing a new unchanged ACK.
  const staged=harness(),stageReq=staged.request([staged.dto('staged')]);
  const journalFactory=staged.c.reportReceiptJournal_;
  staged.c.reportReceiptJournal_=s=>{const j=journalFactory(s);return {...j,commit:()=>{throw Error('marker unavailable');}};};
  const stageAck=staged.execute(stageReq);staged.c.reportReceiptJournal_=journalFactory;staged.cache.clear();
  // A subsequent request must finalize the matching old evidence BEFORE it
  // can legitimately edit that row. The original ACK stays exact afterwards.
  staged.execute(staged.request([staged.dto('staged',1001,'later')]));
  assert.equal(JSON.stringify(staged.execute(stageReq)),JSON.stringify(stageAck));assert.equal(staged.writes(),2);
  // No data write when the durable intent cannot be stored.
  const unavailable=harness();unavailable.c.reportReceiptJournal_=()=>({find:()=>null,pending:()=>[],prepare:()=>{throw Error('journal unavailable');}});
  assert.throws(()=>unavailable.execute(unavailable.request([unavailable.dto('no-write')])),/journal unavailable/);assert.equal(unavailable.writes(),0);
  // Orphan path: only signed read-only proof, exact ID/version/hash/SYNCED,
  // no mutation, only the selected REPORT_INTERNAL_ERROR operation is removed.
  for(const mismatch of ['none','hash','version','status','missing','edited','storage']){
    const p=harness();p.execute(p.request([p.dto('orphan')]));
    p.seed({endpoint:p.config.dispatcherReportEndpoint,operations:[{id:'orphan',action:'upsert',version:1000,attempts:3,error:'REPORT_INTERNAL_ERROR'},{id:'neighbor',action:'upsert',version:1000,attempts:1,error:'STALE_VERSION'},{id:'historical',action:'upsert',version:1,attempts:0,error:'INVALID_DTO'}]});
    const sends=[],original=p.deps.send;let readCount=0;
    p.deps.send=async(u,r)=>{sends.push(r);const answer=await original(u,r);if(mismatch==='hash')answer.source_hash='f'.repeat(64);if(mismatch==='version')answer.source_version++;if(mismatch==='status')answer.sync_status='DELETED';if(mismatch==='missing')return {ok:false,code:'REPORT_RECEIPT_MISMATCH'};if(mismatch==='edited')p.deps.dto=async(t,v)=>p.dto(t.id,v,'edit');if(mismatch==='storage')p.deps.storage.setItem=()=>{throw Error('quota');};return answer;};
    const pq=p.q(),before=p.writes();const ok=await pq.reconcileStored('orphan');
    assert.equal(ok,mismatch==='none',mismatch);assert.equal(p.writes(),before);assert(sends.every(r=>r.action==='report_receipt'));assert.equal(sends.length,1);
    assert.equal(pq.delivery('neighbor').code,'STALE_VERSION');assert.equal(pq.delivery('historical').code,'INVALID_DTO');
    if(mismatch==='none'){assert.equal(pq.status().unresolved,2);assert.equal(pq.delivery('orphan').state,'sent');assert.equal(p.q().delivery('orphan').state,'sent');}
    else if(mismatch!=='storage')assert.equal(pq.status().unresolved,3);
    if(mismatch==='storage')assert.equal(p.q().status().unresolved,3,'failed local persistence cannot lose durable queue');
    assert.equal(await pq.reconcileStored('neighbor'),false);assert.equal(sends.length,1);
  }
  // Server proof requires hash AND sync status, rejects unknown fields.
  const proof={ticket_id:'a',source_version:1000,source_hash:h.dto('a').source_hash};
  assert(h.execute({action:'report_receipt',proof,request_id:'proof-good'}).ok);
  assert.equal(h.execute({action:'report_receipt',proof:{...proof,source_hash:'f'.repeat(64)},request_id:'proof-bad'}).code,'REPORT_RECEIPT_MISMATCH');
  assert.throws(()=>h.execute({action:'report_receipt',proof:{...proof,payload:'private'},request_id:'proof-invalid'}),/INVALID_PROOF/);
  console.log('Durable commit ACK + render isolation + exact orphan proof: PASS (A–F, cache loss, partial ACK, WAL recovery, fail-closed journal/write, no mutation reconcile)');
})().catch(e=>{console.error(e);process.exitCode=1;});
