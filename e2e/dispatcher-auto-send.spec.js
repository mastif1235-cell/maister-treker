'use strict';
/* v91.94 / runtime-139. Auto-send (task 1): a saved ticket reaches Таблиця Д
   without a Settings visit; an app restart re-attaches to the SAME named
   bridge window (no popup spam, no duplicate sends, ACK path unchanged). */
const fs=require('node:fs');
const {test,expect,gotoApp,waitAppReady,createTicketViaUi}=require('./app-test');

test('auto-send: saved ticket delivers by itself and the session revives after an app restart',async({page,context,appEnv})=>{
  const html=fs.readFileSync(require('path').join(__dirname,'../gas/dispatcher-report/Bridge.html'),'utf8');
  let popupCount=0;
  context.on('page',()=>{popupCount++;});
  await context.route('https://script.google.com/macros/s/synthetic/exec?**',async route=>{
    const u=new URL(route.request().url()),config={origin:u.searchParams.get('origin'),channel:u.searchParams.get('channel')};
    const runner=`<script>let done;const ids=new Set();window.google={script:{run:{withSuccessHandler(fn){done=fn;return this},withFailureHandler(){return this},async reportDispatch(request){const callback=done;window.testRequests=(window.testRequests||[]).concat(request);
      if(request.action==='report_upsert'){ids.add(request.ticket.ticket_id);callback({ok:true,inserted:1,updated:0,unchanged:0,deleted:0,rejected:0,errors:0});return;}
      if(request.action==='report_sync_all'){for(const t of request.tickets)ids.add(t.ticket_id);callback({ok:true,inserted:request.tickets.length,updated:0,unchanged:0,deleted:0,rejected:0,errors:0});return;}
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...ids].sort())));callback({ok:true,active_count:ids.size,deleted_count:0,id_set_hash:Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''),earliest_date:'2026-10-08',latest_date:'2026-10-08'});}}}};</script>`;
    await route.fulfill({contentType:'text/html; charset=utf-8',body:html.replace('<script>',runner+'<script>').replace('<?!= bridgeConfig ?>',JSON.stringify(config))});
  });
  await gotoApp(page,appEnv.url);
  // One-time channel setup, exactly as the user does it on day one.
  await page.click('.tab-btn[data-tab="settings"]');await page.locator('[data-settings-hub="sync"]').click();
  await page.evaluate(()=>{for(let p=document.getElementById('dispatcherReportEndpoint').parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
  await page.locator('#dispatcherReportEndpoint').fill('https://script.google.com/macros/s/synthetic/exec');
  await page.locator('#dispatcherReportEnabled').check();
  await page.locator('[data-dispatcher-action="save"]').click();
  const opened=context.waitForEvent('page');await page.locator('[data-dispatcher-action="authorize"]').click();const popup=await opened;
  await expect(popup.locator('#status')).toHaveText('Таблиця Д підключена. Можна повернутися до Майстер-Трекера.');
  expect(popupCount).toBe(1);

  // A) Saved through the real calculator UI → sent with zero extra clicks.
  await createTicketViaUi(page,'Auto Send Alpha');
  await page.waitForFunction(()=>{const t=tickets.find(x=>x.clientName==='Auto Send Alpha');return !!t&&MTDispatcherReport.delivery(t.id).state==='sent';},null,{timeout:20000});

  // B) Android-style process restart: in-memory bridge state is gone. The
  // durable queue must re-attach to the still-open named bridge window and
  // send by itself — no Settings visit, no second popup.
  await page.reload({waitUntil:'domcontentloaded'});
  await waitAppReady(page);
  expect(popupCount).toBe(1);
  await createTicketViaUi(page,'Auto Send Beta');
  await page.waitForFunction(()=>{const t=tickets.find(x=>x.clientName==='Auto Send Beta');return !!t&&MTDispatcherReport.delivery(t.id).state==='sent';},null,{timeout:20000});
  expect(popupCount).toBe(1);
  // Both tickets acknowledged exactly once — no duplicate rows are created.
  const sent=await page.evaluate(()=>{const ids=tickets.filter(t=>t.clientName&&t.clientName.startsWith('Auto Send')).map(t=>t.id);return ids.map(id=>MTDispatcherReport.delivery(id).state);});
  expect(sent).toEqual(['sent','sent']);
});
