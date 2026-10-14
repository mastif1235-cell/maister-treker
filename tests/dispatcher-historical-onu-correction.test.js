'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const source=fs.readFileSync('js/dispatcher-report-client.js','utf8');
const allowed=['1778579833958','1776093623146'];
const fingerprint=ticket=>crypto.createHash('sha256').update(ticket.id+'#'+ticket.sum).digest('hex');
function harness({auto=true,badReadback=false,badSecond=false,direct=true}={}){
  let raw=null,clock=1790000000000;const timers=new Map(),requests=[],tickets=allowed.map((id,index)=>({id,date:index?'13.04.2026':'12.05.2026',time:index?'18:20':'12:57',sum:index?300:1600}));
  const ctx={URL};vm.runInNewContext(source,ctx);
  const dto=async(ticket,version)=>({ticket_id:ticket.id,source_version:version,work_date:ticket.id===allowed[0]?'2026-05-12':'2026-04-13',work_time:ticket.id===allowed[0]?'12:57':'18:20',work_category:'repair',onu_used:0,onu_replacement:0,total:badSecond&&ticket.id===allowed[1]?ticket.sum+1:ticket.sum,source_hash:fingerprint(ticket)});
  const deps={storage:{getItem:()=>raw,setItem:(_key,value)=>{raw=value;}},settings:()=>({dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',dispatcherReportEnabled:auto}),tickets:()=>tickets,ticket:id=>tickets.find(t=>t.id===id)||null,authorizedDirect:()=>direct,dto,now:()=>clock++,requestId:()=>`new-request-${clock++}`,online:()=>true,storeReady:()=>true,setTimeout:fn=>{const id=clock++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),send:async(_url,request)=>{requests.push(structuredClone(request));if(request.action==='report_receipt'){const p=request.proof;return {ok:true,code:'OK',ticket_id:p.ticket_id,source_version:p.source_version,source_hash:badReadback?'0'.repeat(64):p.source_hash,sync_status:'SYNCED'};}return {ok:true,items:request.tickets.map(t=>({ticket_id:t.ticket_id,action:'upsert',source_version:t.source_version,status:'synced',code:'OK'}))};}};
  return {q:ctx.MTDispatcherReportClient.createOutbox(deps),requests,tickets,timers};
}
(async()=>{
  const h=harness();
  h.q.enqueueDelete('neighbor');
  const before=JSON.stringify(h.tickets),result=await h.q.correctHistoricalOnu(allowed[0],fingerprint(h.tickets[0]));
  assert.equal(JSON.stringify(h.tickets),before,'canonical ticket is never edited');
  assert.equal(result.ok,true);assert.equal(result.ticket_id,allowed[0]);assert.equal(result.onu_used,0);assert.equal(result.onu_replacement,0);assert.equal(result.total,1600);
  assert.equal(h.requests.length,2,'one mutation request plus one read-only exact receipt check');
  const mutation=h.requests[0];assert.equal(mutation.action,'report_sync_all');assert.equal(mutation.rebuild,false);assert.deepEqual(mutation.deletes,[]);assert.deepEqual(mutation.tickets.map(t=>t.ticket_id),[allowed[0]]);
  assert.ok(mutation.request_id);assert.equal(h.requests[1].action,'report_receipt');assert.notEqual(h.requests[1].request_id,mutation.request_id);
  assert.equal(h.q.delivery(allowed[0]).state,'sent');assert.equal(h.q.delivery('neighbor').state,'pending');assert.equal(h.q.status().unresolved,1,'only unrelated pre-existing queue item remains');
  await assert.rejects(()=>h.q.correctHistoricalOnu('1786990035908'),/HISTORICAL_TICKET_NOT_ALLOWLISTED/);
  const badProjection=harness({badSecond:true});await assert.rejects(()=>badProjection.q.correctHistoricalOnu(allowed[1],fingerprint(badProjection.tickets[1])),/HISTORICAL_PROJECTION_MISMATCH/);assert.equal(badProjection.requests.length,0,'projection/sum mismatch stops before any write');
  const changed=harness(),oldHash=fingerprint(changed.tickets[0]);changed.tickets[0].sum++;await assert.rejects(()=>changed.q.correctHistoricalOnu(allowed[0],oldHash),/HISTORICAL_SOURCE_CHANGED/);assert.equal(changed.requests.length,0,'confirmation cannot apply to a changed local ticket');
  const bridgeOnly=harness({direct:false});await assert.rejects(()=>bridgeOnly.q.correctHistoricalOnu(allowed[0],fingerprint(bridgeOnly.tickets[0])),/REPORT_DIRECT_AUTH_REQUIRED/);assert.equal(bridgeOnly.requests.length,0,'legacy bridge cannot run the historical correction');
  const readbackHarness=harness({badReadback:true});await assert.rejects(()=>readbackHarness.q.correctHistoricalOnu(allowed[0],fingerprint(readbackHarness.tickets[0])),/HISTORICAL_READBACK_MISMATCH/);assert.equal(readbackHarness.requests.length,2,'failed read-back does not trigger a second mutation');
  const second=harness(),secondResult=await second.q.correctHistoricalOnu(allowed[1],fingerprint(second.tickets[1]));assert.equal(secondResult.total,300);assert.equal(second.requests[0].rebuild,false);

  assert.match(source,/deps\.send\(url,\{action:'report_receipt',proof,request_id:deps\.requestId\(\)\}\)/,'read-back uses the existing authenticated dispatcher send dependency');
  assert.match(source,/historicalCorrection:id,skipRebuild:true/);
  assert.match(fs.readFileSync('index.html','utf8'),/data-dispatcher-action="historicalOnuCorrection"/,'UI action is behind the explicit confirmation flow');
  console.log('PASS historical correction allowlist, isolated per-ID ACK/read-back, no rebuild, unchanged sum and canonical data');
})().catch(error=>{console.error(error);process.exitCode=1;});
