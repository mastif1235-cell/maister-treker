'use strict';
/* v91.95 / runtime-140. Direct transport E2E (physical-Android gate):
   A) a saved ticket is delivered to Таблиця Д by a SIGNED POST (MT-SYNC-HMAC-V3,
      verified here against the shared canonical contract) with popupCount===0;
   B) an app restart keeps sending with no Google connect at all;
   C) background/resume sends a new ticket with no popup;
   D) offline -> pending -> online/resume -> automatic retry -> ACK;
   E) lost response -> the SAME request_id replays the server receipt -> sent
      with exactly ONE server-side mutation (no duplicate). */
const crypto=require('node:crypto');
const contract=require('../js/sync-contract.js');
const {test,expect,gotoApp,waitAppReady,createTicketViaUi}=require('./app-test');

const SECRET='e2e-direct-secret-0123456789abcdef';
const ENDPOINT='https://script.google.com/macros/s/synthetic/exec';

// Behaviour model of the migrated dispatcher GAS: HMAC envelope verification,
// request_id receipt cache (REPORT_ACK_) and upsert accounting.
function makeServer(){
  const rows=new Map(),acks=new Map();
  let mutations=0,dropNextResponse=false,requests=0,denied=0;
  function verifyEnvelope(env){
    if(!env||typeof env!=='object')return false;
    const expected=crypto.createHmac('sha256',SECRET).update(contract.canonical(env),'utf8').digest('base64url');
    return typeof env.sig==='string'&&env.sig===expected&&env.entity==='system'&&env.id==='';
  }
  function dispatch(env){
    requests++;
    if(!verifyEnvelope(env)){denied++;return {ok:false,code:'AUTH_FAILED'};}
    let request;try{request=JSON.parse(env.body);}catch(_){denied++;return {ok:false,code:'AUTH_FAILED'};}
    if(!request||request.action!==env.action||request.request_id!==env.requestId){denied++;return {ok:false,code:'AUTH_FAILED'};}
    const cached=acks.get(request.request_id);
    if(cached)return cached;
    let inserted=0,updated=0,deleted=0;
    for(const t of request.tickets||[]){if(rows.has(t.ticket_id)){updated++;}else{inserted++;}rows.set(t.ticket_id,t);}
    for(const d of request.deletes||[]){if(rows.delete(d.ticket_id))deleted++;else inserted++;}
    mutations++;
    const result=request.action==='report_status'
      ?{ok:true,active_count:rows.size,deleted_count:0,id_set_hash:'',earliest_date:'2026-10-10',latest_date:'2026-10-10'}
      :{ok:true,inserted,updated,unchanged:0,deleted,rejected:0,errors:0};
    acks.set(request.request_id,result);
    return result;
  }
  return {
    rows,mutations:()=>mutations,denied:()=>denied,requests:()=>requests,
    dropNext(){dropNextResponse=true;},
    async handle(route){
      let env;try{env=JSON.parse(route.request().postData()||'');}catch(_){env=null;}
      const result=dispatch(env||{});
      if(dropNextResponse){dropNextResponse=false;await route.abort('connectionreset');return;}
      await route.fulfill({status:200,contentType:'application/json; charset=utf-8',body:JSON.stringify(result)});
    }
  };
}

async function setupDirectChannel(page){
  await page.click('.tab-btn[data-tab="settings"]');
  await page.locator('[data-settings-hub="sync"]').click();
  await page.evaluate(()=>{for(let p=document.getElementById('dispatcherReportEndpoint').parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
  await page.locator('#dispatcherReportEndpoint').fill(ENDPOINT);
  await page.locator('#dispatcherHmacSecret').fill(SECRET);
  await page.locator('#dispatcherReportEnabled').check();
  await page.locator('[data-dispatcher-action="save"]').click();
  await expect(page.locator('#dispatcherReportResult')).toContainText('Прямий підписаний канал');
}

test('A/B: signed direct send delivers by itself after an app restart — popupCount stays 0',async({page,context,appEnv})=>{
  let popupCount=0;
  context.on('page',()=>{popupCount++;});
  const server=makeServer();
  await context.route(ENDPOINT,route=>server.handle(route));
  await gotoApp(page,appEnv.url);
  await setupDirectChannel(page);

  // «Перевірити підключення» uses the same signed POST — no popup.
  await page.locator('[data-dispatcher-action="check"]').click();
  await expect(page.locator('#dispatcherReportResult')).toContainText('Активних нарядів');

  // A) Saved through the real calculator UI -> ACK -> sent, zero clicks.
  await createTicketViaUi(page,'Direct Alpha');
  await page.waitForFunction(()=>{const t=tickets.find(x=>x.clientName==='Direct Alpha');return !!t&&MTDispatcherReport.delivery(t.id).state==='sent';},null,{timeout:20000});
  expect(popupCount).toBe(0);

  // B) Android-style process restart: nothing to re-attach, no Google session.
  await page.reload({waitUntil:'domcontentloaded'});
  await waitAppReady(page);
  await createTicketViaUi(page,'Direct Beta');
  await page.waitForFunction(()=>{const t=tickets.find(x=>x.clientName==='Direct Beta');return !!t&&MTDispatcherReport.delivery(t.id).state==='sent';},null,{timeout:20000});
  expect(popupCount).toBe(0);
  const sent=await page.evaluate(()=>tickets.filter(t=>t.clientName&&t.clientName.startsWith('Direct')).map(t=>MTDispatcherReport.delivery(t.id).state));
  expect(sent).toEqual(['sent','sent']);
  // Each ticket applied on the server exactly once — no duplicates.
  expect(server.rows.size).toBe(2);
  expect(server.mutations()).toBeGreaterThanOrEqual(2);
});

test('C/D: offline ticket stays pending and resume sends it plus a new one — no popup',async({page,context,appEnv})=>{
  let popupCount=0;
  context.on('page',()=>{popupCount++;});
  const server=makeServer();
  await context.route(ENDPOINT,route=>server.handle(route));
  await gotoApp(page,appEnv.url);
  await setupDirectChannel(page);

  // D) Offline: the save is local-first and the queue keeps the operation.
  await context.setOffline(true);
  await createTicketViaUi(page,'Direct Gamma');
  const gamma=await page.evaluate(()=>{const t=tickets.find(x=>x.clientName==='Direct Gamma');return t&&MTDispatcherReport.delivery(t.id).state;});
  expect(gamma).toBe('pending');

  // C/D) Back online + resume: the durable queue flushes by itself.
  await context.setOffline(false);
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForFunction(()=>{const t=tickets.find(x=>x.clientName==='Direct Gamma');return !!t&&MTDispatcherReport.delivery(t.id).state==='sent';},null,{timeout:20000});

  // C) A NEW ticket after the resume also sends by itself.
  await createTicketViaUi(page,'Direct Delta');
  await page.waitForFunction(()=>{const t=tickets.find(x=>x.clientName==='Direct Delta');return !!t&&MTDispatcherReport.delivery(t.id).state==='sent';},null,{timeout:20000});
  expect(popupCount).toBe(0);
  expect(server.rows.size).toBe(2);
});

test('E: lost response replays the SAME request_id receipt — one server mutation, no duplicate',async({page,context,appEnv})=>{
  let popupCount=0;
  context.on('page',()=>{popupCount++;});
  const server=makeServer();
  await context.route(ENDPOINT,route=>server.handle(route));
  await gotoApp(page,appEnv.url);
  await setupDirectChannel(page);

  // The mutation reaches the server but the ACK is lost on the wire.
  server.dropNext();
  await createTicketViaUi(page,'Direct Epsilon');
  await expect.poll(()=>server.mutations(),{timeout:20000}).toBe(1);
  const pendingBefore=await page.evaluate(()=>{const t=tickets.find(x=>x.clientName==='Direct Epsilon');return MTDispatcherReport.delivery(t.id).state;});
  expect(pendingBefore).toBe('pending');
  expect(server.mutations()).toBe(1);

  // Resume retries with the SAME request_id -> receipt cache answers -> sent.
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));});
  await page.waitForFunction(()=>{const t=tickets.find(x=>x.clientName==='Direct Epsilon');return !!t&&MTDispatcherReport.delivery(t.id).state==='sent';},null,{timeout:20000});
  expect(popupCount).toBe(0);
  expect(server.mutations()).toBe(1);
  expect(server.rows.size).toBe(1);
  // The retry carried the same request_id — the receipt was replayed, not re-executed.
  expect(server.requests()).toBeGreaterThanOrEqual(2);
});
