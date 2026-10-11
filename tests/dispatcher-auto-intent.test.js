'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/dispatcher-report-client.js','utf8');
function harness(){
  let raw=null,clock=1000,unavailable=false;const timers=new Map(),calls=[],config={dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',dispatcherReportEnabled:false};
  const ctx={URL};vm.runInNewContext(source,ctx);
  const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>{raw=v;}},settings:()=>config,tickets:()=>[],ticket:()=>null,now:()=>clock,requestId:()=> 'synthetic-request-'+clock++,setTimeout:fn=>{const id=clock++;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),send:async(_u,r)=>{calls.push(r);if(unavailable)throw new Error('REPORT_NETWORK_ERROR');return {ok:true,inserted:0,updated:0,unchanged:0,deleted:r.deletes.length};}};
  let q=ctx.MTDispatcherReportClient.createOutbox(deps);
  return {get q(){return q;},config,calls,raw:()=>JSON.parse(raw),timers,fail:v=>{unavailable=v;},advance:()=>{clock+=10000;},reload:()=>{q=ctx.MTDispatcherReportClient.createOutbox(deps);},tick:async()=>{const tasks=[...timers.values()];timers.clear();for(const fn of tasks)fn();await q.flush({reason:'auto'});}};
}
(async()=>{
  const h=harness();h.q.enqueueDelete('off');h.q.connectionReady();await h.tick();
  assert.equal(h.calls.length,0);assert.equal(h.q.status().pending,1);assert.equal(h.q.status().lastError,'');
  h.reload();h.q.connectionReady();await h.tick();assert.equal(h.calls.length,0);
  h.config.dispatcherReportEnabled=true;h.q.connectionReady();await h.tick();assert.equal(h.calls.length,1);assert.equal(h.q.status().unresolved,0);
  h.q.connectionReady();await h.tick();assert.equal(h.calls.length,1,'no duplicate');
  h.q.enqueueDelete('on');await h.tick();assert.equal(h.calls.length,2);
  // A previously scheduled AUTO task must re-check OFF when it actually runs.
  h.q.enqueueDelete('scheduled');h.config.dispatcherReportEnabled=false;await h.tick();assert.equal(h.calls.length,2);assert.equal(h.q.status().pending,1);
  h.config.dispatcherReportEnabled=true;h.fail(true);h.q.connectionReady();await h.tick();assert.equal(h.q.status().unresolved,1);
  h.fail(false);h.advance();h.q.connectionReady();await h.tick();assert.equal(h.q.status().unresolved,0);
  // OFF manual retry selects one ID, never changes the toggle or sends siblings.
  h.config.dispatcherReportEnabled=false;h.q.enqueueDelete('selected');h.q.enqueueDelete('neighbor');
  const before=h.calls.length;await h.q.retry('selected');await h.tick();assert.equal(h.calls.length,before+1);
  assert.equal(JSON.stringify(h.calls.at(-1).deletes.map(d=>d.ticket_id)),JSON.stringify(['selected']));assert.equal(h.q.delivery('neighbor').state,'pending');assert.equal(h.config.dispatcherReportEnabled,false);
  // Actual browser lifecycle callbacks with OFF, not just a mocked resume().
  const events={},docEvents={},store=new Map();let sends=0;
  const ctx={URL,AbortController,crypto:require('node:crypto').webcrypto,navigator:{onLine:true},settings:{dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',dispatcherReportEnabled:false,dispatcherHmacSecret:'synthetic-only-secret-0123456789012345'},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},sessionStorage:{getItem:()=>null},setTimeout:()=>1,clearTimeout:()=>{},fetch:async()=>{sends++;throw Error('unexpected AUTO send');},document:{visibilityState:'visible',getElementById:()=>null,querySelectorAll:()=>[],addEventListener:(n,fn)=>{docEvents[n]=fn;}},addEventListener:(n,fn)=>{events[n]=fn;},__mtTicketsStoreReady:true,MTSyncTransport:{signedEnvelope:async r=>r}};
  ctx.window=ctx;ctx.document.querySelector=()=>null;vm.runInNewContext(source,ctx);ctx.MTDispatcherReport.enqueueDelete('pending');
  for(const event of ['focus','pageshow','online']){await events[event]();assert.equal(sends,0,event+' respects OFF');}
  ctx.document.visibilityState='hidden';await docEvents.visibilitychange();ctx.document.visibilityState='visible';await docEvents.visibilitychange();await docEvents.DOMContentLoaded();
  ctx.MTDispatcherReport.connectionReady();await ctx.MTDispatcherReport.flush({reason:'auto'});assert.equal(sends,0);assert.equal(ctx.MTDispatcherReport.status().pending,1);
  const saved=JSON.parse(store.get('mtDispatcherReportOutboxV1'));
  saved.operations.push({id:'real-stale',action:'delete',version:1,attempts:1,error:'STALE_VERSION'},{id:'historical',action:'delete',version:1,attempts:0,error:'INVALID_DTO'});store.set('mtDispatcherReportOutboxV1',JSON.stringify(saved));
  vm.runInNewContext(source,ctx);await docEvents.DOMContentLoaded();assert.equal(sends,0);assert.equal(ctx.MTDispatcherReport.delivery('real-stale').code,'STALE_VERSION');assert.equal(ctx.MTDispatcherReport.delivery('historical').code,'INVALID_DTO');
  ctx.settings.dispatcherReportEnabled=true;
  ctx.fetch=async(_u,opts)=>{sends++;const r=JSON.parse(opts.body);assert.equal(JSON.stringify(r.body.deletes.map(d=>d.ticket_id)),JSON.stringify(['pending']),'ON resume never retries permanent errors');return {json:async()=>({ok:true,inserted:0,updated:0,unchanged:0,deleted:1})};};
  await events.focus();await ctx.MTDispatcherReport.flush({reason:'auto'});assert.equal(sends,1);assert.equal(ctx.MTDispatcherReport.status().failed,2);
  // OFF changed while projection is awaited must stop before network I/O.
  let resolveDTO;const race=harness();race.config.dispatcherReportEnabled=true;
  const raceCtx={URL};vm.runInNewContext(source,raceCtx);
  let raceSends=0;const raceConfig={dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',dispatcherReportEnabled:true};
  const raceQ=raceCtx.MTDispatcherReportClient.createOutbox({storage:{getItem:()=>null,setItem:()=>{}},settings:()=>raceConfig,now:()=>1000,requestId:()=> 'synthetic-race',ticket:()=>({id:'race'}),dto:()=>new Promise(r=>{resolveDTO=r;}),setTimeout:()=>1,clearTimeout:()=>{},send:async()=>{raceSends++;return {ok:true};}});
  raceQ.enqueueUpsert({id:'race'});const sending=raceQ.flush({reason:'auto'});raceConfig.dispatcherReportEnabled=false;resolveDTO({ticket_id:'race',source_version:1000});await sending;assert.equal(raceSends,0);assert.equal(raceQ.status().pending,1);assert.equal(raceQ.status().lastError,'');
  console.log('PASS AUTO OFF lifecycle/timers/reload, ON recovery, scoped MANUAL retry, historical isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
