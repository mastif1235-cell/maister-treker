'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const c={globalThis:{},URL};vm.runInNewContext(fs.readFileSync('js/dispatcher-report-client.js','utf8'),c);
function harness(){
  const tickets=Array.from({length:434},(_,i)=>({id:'test-'+i,masterNote:'PRIVATE-CANARY',phone:'PHONE-CANARY'}));
  let raw=null,clock=1000;const missing=new Set(),calls=[],stored=new Map();
  const config={dispatcherReportEndpoint:'https://script.google.com/macros/s/test/exec',dispatcherReportEnabled:true};
  const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>raw=v},settings:()=>config,tickets:()=>tickets,ticket:id=>missing.has(id)?null:tickets.find(t=>t.id===id),dto:async(t,v)=>({ticket_id:t.id,source_version:v}),now:()=>++clock,requestId:()=>crypto.randomUUID(),online:()=>true,setTimeout:()=>1,clearTimeout:()=>{},send:async(_u,r)=>{calls.push(r);for(const t of r.tickets)stored.set(t.ticket_id,t);for(const t of r.deletes)stored.delete(t.ticket_id);return {ok:true,inserted:r.tickets.length,updated:0,unchanged:0,deleted:r.deletes.length,rejected:0,errors:0};}};
  const factory=()=>c.globalThis.MTDispatcherReportClient.createOutbox(deps);
  const hash=()=>crypto.createHash('sha256').update(JSON.stringify([...stored.keys()].sort())).digest('hex');
  return {q:factory(),factory,deps,config,tickets,missing,calls,stored,raw:()=>JSON.parse(raw),hash};
}
(async()=>{
  const a=harness();await a.q.syncAll();let s=a.q.status();
  assert.equal(s.sync.expected_count,434);assert.equal(s.sync.received_ack_count,434);assert.equal(s.sync.failed_count,0);assert.equal(s.sync.unresolved_count,0);assert.equal(s.sync.batch_count,9);assert.equal(s.sync.final_validation,'PENDING','ACK completion alone is not final archive PASS');
  assert.throws(()=>a.q.confirmArchive({ok:true,active_count:433,id_set_hash:a.hash()},a.hash(),434),/REPORT_ARCHIVE_MISMATCH/);
  assert.throws(()=>a.q.confirmArchive({ok:true,active_count:434,id_set_hash:'0'.repeat(64)},a.hash(),434),/REPORT_ARCHIVE_MISMATCH/);
  assert.equal(a.q.status().sync.final_validation,'FAIL');
  a.q.confirmArchive({ok:true,active_count:434,id_set_hash:a.hash()},a.hash(),434);assert.equal(a.q.status().sync.final_validation,'PASS');
  assert.equal(a.factory().status().sync.received_ack_count,434,'progress survives reload');

  const b=harness();b.missing.add('test-0');await assert.rejects(b.q.syncAll(),/REPORT_SYNC_INCOMPLETE/);s=b.q.status();
  assert.equal(b.stored.size,433);assert.equal(s.sync.expected_count,434);assert.equal(s.sync.received_ack_count,433);assert.equal(s.failed,1);assert.equal(s.unresolved,1);assert.equal(s.sync.failed_count,1);assert.equal(s.sync.unresolved_count,1);assert.equal(s.sync.batch_count,9);
  assert.equal(s.sync.final_validation,'FAIL');
  assert.equal(b.raw().operations[0].error,'TICKET_LOOKUP_MISSING');assert.equal(b.raw().operations[0].id,'test-0');
  assert.deepEqual(Object.keys(b.raw().diagnostics[0]).sort(),['operation_type','reason','ticket_id','timestamp']);
  assert.equal(b.raw().diagnostics[0].reason,'TICKET_LOOKUP_MISSING');assert(!JSON.stringify(b.raw()).includes('PRIVATE-CANARY'));assert(!JSON.stringify(b.raw()).includes('PHONE-CANARY'));
  assert.throws(()=>b.q.confirmArchive({ok:true,active_count:434,id_set_hash:b.hash()},b.hash(),434),/REPORT_ARCHIVE_MISMATCH/,'cannot PASS with unresolved IDs');
  const recovered=b.factory();assert.equal(recovered.status().unresolved,1);b.missing.clear();recovered.connectionReady();recovered.retry();await recovered.flush();
  assert.equal(b.stored.size,434);assert.equal(recovered.status().sync.received_ack_count,434);assert.equal(recovered.status().unresolved,0);
  recovered.confirmArchive({ok:true,active_count:434,id_set_hash:b.hash()},b.hash(),434);assert.equal(recovered.status().sync.final_validation,'PASS');

  const many=harness();for(let i=0;i<60;i++)many.missing.add('test-'+i);
  await assert.rejects(many.q.syncAll(),/REPORT_SYNC_INCOMPLETE/);assert.equal(many.stored.size,374);assert.equal(many.q.status().failed,60);assert.equal(many.raw().operations.length,60);assert.equal(many.raw().diagnostics.length,60);assert.equal(many.q.status().sync.received_ack_count,374);
  // Rebuilding a queue from a smaller live source must not discard old missing upserts.
  many.tickets.splice(0,60);many.q.fullSync();assert.equal(many.q.status().sync.expected_count,434);assert.equal(many.q.status().unresolved,434);assert.equal(many.raw().operations.filter(o=>o.error==='TICKET_LOOKUP_MISSING').length,60);

  const deleted=harness();deleted.missing.add('test-0');await assert.rejects(deleted.q.syncAll(),/REPORT_SYNC_INCOMPLETE/);
  deleted.tickets.splice(0,1);deleted.config.dispatcherReportEnabled=false;assert.equal(deleted.q.enqueueDelete('test-0'),true,'explicit delete replaces pending missing upsert even with automatic enqueue off');await deleted.q.flush();
  assert.equal(deleted.calls.at(-1).tickets.length,0);assert.equal(deleted.calls.at(-1).deletes[0].ticket_id,'test-0');assert.equal(deleted.stored.size,433);assert.equal(deleted.q.status().sync.received_ack_count,434);assert.equal(deleted.q.status().sync.unresolved_count,0);
  deleted.q.confirmArchive({ok:true,active_count:433,id_set_hash:deleted.hash()},deleted.hash(),433);assert.equal(deleted.q.status().sync.final_validation,'PASS','explicit tombstone acknowledged, not inferred from absence');

  const noCounters=harness();noCounters.deps.send=async()=>({ok:true});await assert.rejects(noCounters.q.syncAll(),/REPORT_PARTIAL_ACK/);assert.equal(noCounters.q.status().sync.received_ack_count,0);assert.equal(noCounters.q.status().unresolved,434);
  const offline=harness();offline.deps.online=()=>false;await assert.rejects(offline.q.syncAll(),/REPORT_SYNC_INCOMPLETE/);assert.equal(offline.q.status().unresolved,434);assert.equal(offline.q.status().sync.batch_count,0);
  console.log('PASS 434/434 ACK, missing lookup retained, safe diagnostics, multiple missing, reload/retry, explicit tombstone, complete count/hash guard');
})().catch(e=>{console.error(e);process.exitCode=1;});
