'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/dispatcher-report-client.js','utf8');
function setup(send){let clock=1000,raw=null;const timers=[],c={URL};vm.runInNewContext(source,c);
  const config={dispatcherReportEnabled:true,dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec'};
  const q=c.MTDispatcherReportClient.createOutbox({storage:{getItem:()=>raw,setItem:(_k,v)=>raw=v},settings:()=>config,
    now:()=>clock,requestId:()=> 'synthetic-request-'+clock,ticket:()=>null,setTimeout:(_fn,ms)=>{timers.push(ms);return timers.length;},clearTimeout(){},send});
  return {q,timers,config,advance:ms=>{clock+=ms;}};}
(async()=>{
  for(const code of ['BUSY','RATE_LIMITED']){
    let calls=0;const h=setup(async(_url,r)=>{calls++;return {ok:true,items:r.deletes.map(d=>({ticket_id:d.ticket_id,action:'delete',source_version:d.source_version,status:calls===1?'error':'synced',code:calls===1?code:'OK'}))};});
    h.q.enqueueDelete('synthetic');await h.q.flush({reason:'auto'});
    assert.equal(h.q.status().unresolved,1);h.advance(6000);await h.q.flush({reason:'auto'});
    assert.equal(h.q.status().unresolved,0,'per-item '+code+' must recover without retryAll');
  }
  let calls=0;const h=setup(async()=>{calls++;return calls<=3?{ok:false,code:'BUSY'}:{ok:true,inserted:0,updated:0,unchanged:0,deleted:1};});
  h.q.enqueueDelete('synthetic-exhausted');
  for(let i=0;i<3;i++){await h.q.flush({reason:'auto'});h.advance(130000);}
  assert.equal(h.q.status().unresolved,1);
  await h.q.flush({reason:'auto'});assert.equal(h.q.status().unresolved,0,'exhaustion recovers after a bounded cooldown');
  assert.ok(h.timers.some(ms=>ms>=120000),'cooldown is scheduled, not a busy loop');
  let permanentCalls=0;const p=setup(async()=>{permanentCalls++;return {ok:false,code:'STALE_VERSION'};});
  p.q.enqueueDelete('synthetic-stale');await p.q.flush({reason:'auto'});p.advance(130000);await p.q.flush({reason:'auto'});
  assert.equal(permanentCalls,1);assert.equal(p.q.status().unresolved,1);
  console.log('PASS H-2 BUSY/RATE_LIMITED recovery, exhausted cooldown, preserved identities and permanent-error stop');
})().catch(e=>{console.error(e);process.exitCode=1;});
