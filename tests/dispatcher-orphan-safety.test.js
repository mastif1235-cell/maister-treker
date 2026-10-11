'use strict';
// Isolated persisted metadata only. Never open a browser/profile or real outbox.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c={URL,Date,console};vm.createContext(c);vm.runInContext(fs.readFileSync('js/dispatcher-report-client.js','utf8'),c);
const ID='ab60a3df-c5c4-4927-8ee8-7bea835fbd2c',VERSION=1791703794130,HASH='a'.repeat(64);
const clone=v=>JSON.parse(JSON.stringify(v));
function harness(options={}){
  const settings={dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',dispatcherReportEnabled:false};
  const orphan={id:ID,action:'upsert',version:VERSION,attempts:3,next:1791704000000,error:'',...options.orphan};
  const neighbor={id:'neighbor',action:'upsert',version:1001,attempts:1,next:5000,error:'STALE_VERSION'};
  const history={id:'historical',action:'upsert',version:1,attempts:0,next:0,error:'INVALID_DTO'};
  const ops=[orphan,neighbor,history],exact=o=>({id:o.id,action:o.action,version:o.version});
  const flightOps=options.flight==='mixed'?[orphan,neighbor]:options.flight==='last'?[orphan]:options.flight==='unrelated'?[neighbor]:[];
  let raw=JSON.stringify({endpoint:settings.dispatcherReportEndpoint,operations:ops,receipts:[{id:'previous',version:5}],lastError:options.lastError??'REPORT_INTERNAL_ERROR',inflight:flightOps.length?{action:'report_sync_all',request_id:'original-lost-ack',rebuild:false,ts:12345,ops:flightOps.map(exact)}:null,sync:{expected:ops.map(o=>({...exact(o),acknowledged:false})),batch_count:2,final_validation:'PENDING'}});
  let hash=HASH,exists=true,failSave=false;
  const sends=[];let q;
  const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>{if(failSave)throw Error('quota');raw=v;}},settings:()=>settings,ticket:id=>exists?{id}:null,dto:async(t,v)=>({ticket_id:t.id,source_version:v,source_hash:hash}),requestId:()=>'readonly-proof-id',now:()=>VERSION+1,setTimeout:()=>1,clearTimeout:()=>{},send:async(_u,r)=>{
    sends.push(clone(r));const good={ok:true,code:'OK',...r.proof,sync_status:'SYNCED'};
    return options.answer?options.answer(good,{q,settings,edit:()=>hash='b'.repeat(64),missing:()=>exists=false,failSave:()=>failSave=true}):good;
  }};
  q=c.MTDispatcherReportClient.createOutbox(deps);
  return {q,sends,read:()=>JSON.parse(raw),reload:()=>c.MTDispatcherReportClient.createOutbox(deps)};
}
(async()=>{
  // Boolean and shape matrix: reject without ANY persisted state mutation.
  const malformed=[...['true','false',1,0,null,undefined,[],{}].map(ok=>r=>({...r,ok})),r=>{delete r.ok;return r;},()=>null,()=>[],()=>true,()=>({}),r=>({...r,items:[]}),r=>({...r,errors:1}),r=>({...r,deleted_at:'2026-10-11'}),r=>({...r,code:'PARTIAL'}),r=>({...r,ticket_id:'foreign'}),r=>({...r,source_version:VERSION+1}),r=>({...r,source_version:String(VERSION)}),r=>({...r,source_hash:'b'.repeat(64)}),r=>({...r,sync_status:'DELETED'}),r=>({...r,sync_status:'PENDING'}),()=>({ok:false,code:'REPORT_RECEIPT_MISMATCH'})];
  for(const answer of malformed){
    const h=harness({flight:'mixed',answer}),before=h.read();
    assert.equal(await h.q.reconcileStored(ID),false);
    assert.deepEqual(h.read(),before,'malformed/ambiguous proof cannot change queue, receipts, inflight or sync');
    assert.equal(h.sends.length,1);assert.equal(h.sends[0].action,'report_receipt');
  }
  // Real persisted Android shape: empty item error, exhausted, global transient.
  for(const flight of ['none','unrelated','mixed','last']){
    const h=harness({flight}),before=h.read();
    assert.equal(await h.q.reconcileStored(ID),true,flight);
    assert.equal(h.sends.length,1);assert.deepEqual(h.sends[0].proof,{ticket_id:ID,source_version:VERSION,source_hash:HASH});
    assert(h.sends.every(r=>r.action==='report_receipt'&&!r.tickets&&!r.ticket&&!r.deletes));
    const after=h.read();assert.deepEqual(after.operations,before.operations.slice(1));
    assert.deepEqual(after.receipts,[...before.receipts,{id:ID,version:VERSION}]);
    const expected=clone(before.sync);expected.expected[0].acknowledged=true;assert.deepEqual(after.sync,expected);
    assert.equal(after.lastError,before.lastError,'neighbor diagnostic is not cleared');
    if(flight==='unrelated')assert.deepEqual(after.inflight,before.inflight);
    else if(flight==='mixed')assert.deepEqual(after.inflight,{...before.inflight,ops:before.inflight.ops.slice(1)});
    else assert.equal(after.inflight,null);
    assert.equal(h.reload().delivery(ID).state,'sent');
    assert.equal(await h.q.reconcileStored(ID),false);assert.equal(h.sends.length,1,'second proof cannot duplicate a receipt');
  }
  // Never infer permission from attempts alone or from another item's error.
  for(const error of ['STALE_VERSION','STALE_OTHER','INVALID_DTO','INVALID_OTHER','UNKNOWN_FIELD','PRIVACY_REJECTED','HASH_MISMATCH','FORMULA_REJECTED','REPORT_SCHEMA','LEGACY_BAD','DUPLICATE_ID','PAYMENT_INVALID','REPORT_CAPACITY','TICKET_LOOKUP_MISSING']){
    const h=harness({orphan:{error}}),before=h.read();assert.equal(await h.q.reconcileStored(ID),false,error);assert.equal(h.sends.length,0);assert.deepEqual(h.read(),before);
  }
  for(const options of [{orphan:{attempts:2}},{lastError:''},{lastError:'STALE_VERSION'},{orphan:{action:'delete'}},{orphan:{error:'REPORT_INTERNAL_ERROR',attempts:1}}]){
    const h=harness(options),before=h.read();assert.equal(await h.q.reconcileStored(ID),false);assert.equal(h.sends.length,0);assert.deepEqual(h.read(),before);
  }
  // Legacy explicit per-operation transient shape remains supported exhausted.
  const marked=harness({orphan:{error:'REPORT_INTERNAL_ERROR'},lastError:''});assert.equal(await marked.q.reconcileStored(ID),true);
  for(const change of ['superseded','edit','missing','endpoint','generation','storage']){
    let expected;
    const h=harness({flight:'mixed',answer:(r,api)=>{
      if(change==='superseded')api.q.enqueueUpsert({id:ID});
      if(change==='edit')api.edit();
      if(change==='missing')api.missing();
      if(change==='endpoint')api.settings.dispatcherReportEndpoint='https://script.google.com/macros/s/changed/exec';
      if(change==='generation')api.q.reconfigure();
      if(change==='storage')api.failSave();
      expected=h.read();return r;
    }});
    assert.equal(await h.q.reconcileStored(ID),false,change);
    assert.deepEqual(h.read(),expected,change+' must not complete after await');
    assert.equal(h.read().receipts.some(r=>r.id===ID),false);
    assert.equal(h.reload().status().unresolved,3,'durable queue survives '+change);
  }
  console.log('Orphan safety: PASS (strict boolean/shape, real Android metadata, exact inflight/sync isolation, permanent refusal, supersession/edit/config races, persistence failure)');
})().catch(e=>{console.error(e);process.exitCode=1;});
