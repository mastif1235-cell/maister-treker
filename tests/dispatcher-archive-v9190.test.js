'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const core=require('../js/dispatcher-report-core.js');
const source=fs.readFileSync('js/dispatcher-report-client.js','utf8'),c={globalThis:{},URL,setTimeout,clearTimeout};vm.runInNewContext(source,c);
function harness(items){
  let clock=Date.now(),raw=null,calls=[],stored=new Map();
  const settings={dispatcherReportEndpoint:'https://script.google.com/macros/s/test/exec',dispatcherReportEnabled:true};
  const deps={storage:{getItem:()=>raw,setItem:(_k,v)=>raw=v},settings:()=>settings,tickets:()=>items,ticket:id=>items.find(t=>t.id===id),dto:async(t,v)=>({ticket_id:t.id,source_version:v,text:t.text||''}),now:()=>++clock,requestId:()=>crypto.randomUUID(),online:()=>true,setTimeout:()=>1,clearTimeout:()=>{},send:async(_url,r)=>{calls.push(r);for(const t of r.tickets)stored.set(t.ticket_id,t);for(const t of r.deletes)stored.delete(t.ticket_id);return {ok:true,inserted:r.tickets.length,updated:0,unchanged:0,deleted:r.deletes.length,rejected:0,errors:0};}};
  return {deps,q:c.globalThis.MTDispatcherReportClient.createOutbox(deps),calls,stored,raw:()=>raw};
}
(async()=>{
  // Physical Android's all-time counter is list.length, not a 200-row window.
  // Exercise its reported cardinality independently of the 437-row cloud set.
  const totalsContext={};vm.runInNewContext(fs.readFileSync('js/report-utils.js','utf8'),totalsContext);
  const androidTickets=Array.from({length:434},(_,i)=>({id:'android-'+i,date:'15.07.2026',sum:0})),android=harness(androidTickets);
  assert.equal(totalsContext.calculateTicketReportTotals(androidTickets).count,434);
  android.q.fullSync();assert.equal(JSON.parse(android.raw()).operations.length,434,'full sync enqueues the same complete local array');
  for(let i=0;i<9;i++)await android.q.flush();
  assert.deepEqual(android.calls.map(r=>r.tickets.length),[50,50,50,50,50,50,50,50,34]);
  assert.equal(android.stored.size,434);assert.equal(android.q.status().pending,0);assert.equal(android.q.status().failed,0);
  assert.equal((await android.q.archiveDiagnostics()).acknowledged_tickets,434);
  const tickets=Array.from({length:437},(_,i)=>({id:'history-'+i,date:i<200?'19.02.2026':'15.07.2026'})),h=harness(tickets);
  await h.q.syncAll();assert.equal(h.stored.size,437);assert.equal(h.q.status().pending,0);assert.equal(h.calls.length,9);assert(h.calls.slice(0,-1).every(r=>r.rebuild===false));assert.equal(h.calls.at(-1).rebuild,true);
  await h.q.syncAll();assert.equal(h.stored.size,437,'no duplication/date cutoff on repeated full sync');
  const diagnostics=await h.q.archiveDiagnostics();assert.equal(diagnostics.source_tickets,437);assert.equal(diagnostics.projected_tickets,437);assert.equal(diagnostics.acknowledged_tickets,437);assert.equal(diagnostics.missing_receipts,0);assert(!JSON.stringify(diagnostics).includes('history-'));
  const big=harness(Array.from({length:80},(_,i)=>({id:'large-'+i,text:'x'.repeat(15000)})));await big.q.syncAll();assert.equal(big.stored.size,80);assert(big.calls.every(r=>JSON.stringify(r).length<500000));
  const partial=harness([{id:'a'}]);partial.deps.send=async()=>({ok:true,inserted:0,updated:0,unchanged:0,deleted:0});await assert.rejects(partial.q.syncAll(),/REPORT_PARTIAL_ACK/);assert.equal(partial.q.status().pending,1);assert.equal(partial.q.delivery('a').state,'pending');
  const invalid=harness([{id:'bad',text:'=SUM(1,2)'},{id:'good'}]);await assert.rejects(invalid.q.syncAll(),/REPORT_SYNC_INCOMPLETE/);assert.equal(invalid.stored.size,1);assert(invalid.stored.has('good'));assert.equal(invalid.q.status().failed,1);assert.equal(invalid.q.delivery('bad').state,'error');
  const closed=harness([{id:'android-save'}]);closed.deps.send=async()=>{throw new Error('GOOGLE_CONNECTION_REQUIRED');};closed.q.enqueueUpsert(closed.deps.tickets()[0]);await closed.q.flush();assert.equal(closed.q.status().pending,1);assert.equal(closed.q.status().failed,0);closed.deps.send=h.deps.send;closed.q.connectionReady();await closed.q.flush();assert.equal(closed.q.status().pending,0);
  const {buildDTO,reportPresentation}=await import('../js/dispatcher-report-projection.mjs');
  // Redacted historical importer shape; not a claim of reading private July JSON.
  const rawTicket={id:'redacted-history',date:'15.07.2026',time:'12:00',type:'Ремонт',sum:3500,payment:'Готівка',cloudImported:true,equipment:[],cables:[],note:'',content:'🛠️ ONU: 1 шт. х 800 грн\n🛠️ Роутер: 1 шт. х 2300 грн\n🔌 UTP: 12,5м х 10грн\n🛠️ Кріплення: 2 шт. х 0 грн\n🛠️ Нуль: 0 шт. х 10 грн\n📝 Перевірити тариф, signal -18 dBm\n📞 Тел: 000\nПриватна примітка майстра: PRIVATE-CANARY\n📝 DO-NOT-LEAK'};
  const before=JSON.stringify(rawTicket),dto=await buildDTO(rawTicket,core);
  // v91.94 contract: materials show quantity + informational line price from
  // the real content data; a zero price keeps quantity only (never «0 грн»).
  assert.equal(dto.materials_display,'ONU — 1 шт. — 800 грн\nРоутер — 1 шт. — 2300 грн\nUTP — 12.5 м — 125 грн\nКріплення — 2 шт.');assert.equal(dto.dispatcher_comment,'Перевірити тариф');assert.equal(JSON.stringify(rawTicket),before);
  const rendered=core.render([dto]).blocks.find(b=>b.kind==='ticket').text;assert(rendered.includes(dto.materials_display));assert(rendered.includes(dto.dispatcher_comment));assert(!JSON.stringify(dto).includes('PRIVATE-CANARY'));assert(!JSON.stringify(dto).includes('DO-NOT-LEAK'));
  assert.equal(reportPresentation({...rawTicket,cloudImported:false},core).materials,'','explicit structured emptiness wins over stale content');
  const historical=await buildDTO({...rawTicket,type:'Підключення',city:'',address:'',payment:'',content:'📋 ЗАЯВКА: РЕМОНТ\n🏙️ Місто: Тестове\n📍 Адреса: пров. Тестовий 4\n💎 Тариф: 400 грн\n💳 Оплата: Готівка\n🛠️ ONU: 1 шт. х 800 грн\n📝 Уточнити тариф'},core);assert.equal(historical.work_type,'Ремонт');assert.equal(historical.city,'Тестове');assert.equal(historical.address_display,'Тестове, пров. Тестовий 4');assert.equal(historical.payment_cash,3500);assert.equal(historical.dispatcher_comment,'Тариф: 400 грн\nУточнити тариф');
  const structured=await buildDTO({...rawTicket,cloudImported:false,equipment:[{label:'ONU',qty:0},{label:'Роутер',qty:2}],cables:[{label:'UTP',meters:5}],note:'Диспетчеру: роботу завершено, geoLat: 48.45, geoLng: 35.05'},core);assert.equal(structured.materials_display,'Роутер — 2 шт.\nUTP — 5 м');assert(!structured.dispatcher_comment.includes('48.45'));
  assert(!fs.readFileSync('index.html','utf8').includes('dispatcherReportQueueBanner'));assert(!source.includes('dispatcherReportQueueBanner'));
  console.log('PASS archive completeness, repeated sync, payload size, partial ACK, isolated bad item, reconnect, historical materials/note/privacy, no banner');
})().catch(e=>{console.error(e);process.exitCode=1;});
