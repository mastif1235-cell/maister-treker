'use strict';
const fs=require('node:fs'),path=require('node:path');
const {test,expect,gotoApp}=require('./app-test');
test('mobile popup ACK, PWA lifecycle resume, manual sync with auto OFF and per-ticket status',async({page,context,appEnv})=>{
  const html=fs.readFileSync(path.join(__dirname,'../gas/dispatcher-report/Bridge.html'),'utf8');
  const requests=[];let popupCount=0;
  context.on('page',()=>{popupCount++;});
  await context.route('https://script.google.com/macros/s/synthetic/exec?**',async route=>{
    const u=new URL(route.request().url()),config={origin:u.searchParams.get('origin'),channel:u.searchParams.get('channel')};
    // Authentic cross-origin popup mechanics + actual bridge HTML, not a
    // mocked createBridge. Only Google's RPC backend is a synthetic fixture.
    const runner=`<script>let done;const ids=new Set();window.google={script:{run:{withSuccessHandler(fn){done=fn;return this},withFailureHandler(){return this},async reportDispatch(request){const callback=done;window.testRequests=(window.testRequests||[]).concat(request);if(request.action==='report_sync_all'){for(const t of request.tickets)ids.add(t.ticket_id);callback({ok:true,inserted:request.tickets.length,updated:0,unchanged:0,deleted:0,rejected:0,errors:0});return;}const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([...ids].sort())));callback({ok:true,active_count:ids.size,deleted_count:0,id_set_hash:Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join(''),earliest_date:'2026-10-08',latest_date:'2026-10-08'});}}}};</script>`;
    await route.fulfill({contentType:'text/html; charset=utf-8',body:html.replace('<script>',runner+'<script>').replace('<?!= bridgeConfig ?>',JSON.stringify(config))});
  });
  const errors=await gotoApp(page,appEnv.url);
  await page.click('.tab-btn[data-tab="settings"]');await page.locator('[data-settings-hub="sync"]').click();
  await page.evaluate(()=>{for(let p=document.getElementById('dispatcherReportEndpoint').parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
  await page.locator('#dispatcherReportEndpoint').fill('https://script.google.com/macros/s/synthetic/exec');await page.locator('[data-dispatcher-action="save"]').click();
  const opened=context.waitForEvent('page');await page.locator('[data-dispatcher-action="authorize"]').click();const popup=await opened;
  await expect(popup.locator('#status')).toHaveText('Таблиця Д підключена. Можна повернутися до Майстер-Трекера.');
  await expect(page.locator('#dispatcherReportResult')).toContainText('Таблиця Д підключена');
  await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));window.dispatchEvent(new Event('focus'));});
  await page.locator('[data-dispatcher-action="check"]').click();await expect(page.locator('#dispatcherReportResult')).toContainText('Підключено.');expect(popupCount).toBe(1);
  await page.evaluate(()=>{tickets.push({id:'test-mobile-report',date:currentTicketDate,time:'12:34',type:'Ремонт',city:'Тест',address:'Тестова 1',sum:100,payment:'Готівка',content:'Тест'});renderTicketsScreen();});
  await page.locator('[data-dispatcher-action="sync"]').click();await page.waitForFunction(()=>MTDispatcherReport.delivery('test-mobile-report').state==='sent');
  await expect(page.locator('#dispatcherReportResult')).toContainText('Весь архів підтверджено: 1 / 1');
  expect(await page.evaluate(()=>settings.dispatcherReportEnabled)).toBe(false);
  await expect(page.locator('[data-dispatcher-action="sync"]')).toBeEnabled();expect(await page.evaluate(()=>MTDispatcherReport.status().running)).toBe(false);
  requests.push(...await popup.evaluate(()=>window.testRequests));expect(requests.some(r=>r.action==='report_sync_all')).toBe(true);
  await page.click('.tab-btn[data-tab="tickets"]');await expect(page.locator('[data-dispatcher-ticket-status="test-mobile-report"]')).toHaveCount(0);
  await page.locator('#ticketViewModeBtn').click();await expect(page.locator('[data-dispatcher-ticket-status="test-mobile-report"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('popup blocked and timeout settle action buttons and do not enqueue all tickets',async({page,appEnv})=>{
  await page.addInitScript(()=>{window.__reportTestPopupMode='blocked';window.open=()=>window.__reportTestPopupMode==='blocked'?null:{closed:false,close(){}};});
  await gotoApp(page,appEnv.url);await page.click('.tab-btn[data-tab="settings"]');await page.locator('[data-settings-hub="sync"]').click();
  await page.evaluate(()=>{for(let p=document.getElementById('dispatcherReportEndpoint').parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;settings.dispatcherReportEndpoint='https://script.google.com/macros/s/synthetic/exec';});
  await page.locator('[data-dispatcher-action="sync"]').click();await expect(page.locator('#dispatcherReportResult')).toContainText('GOOGLE_POPUP_BLOCKED');await expect(page.locator('[data-dispatcher-action="sync"]')).toBeEnabled();
  expect(await page.evaluate(()=>MTDispatcherReport.status().pending)).toBe(0);
  await page.evaluate(()=>{window.__reportTestPopupMode='timeout';});
  await page.locator('[data-dispatcher-action="authorize"]').click();await expect(page.locator('#dispatcherReportResult')).toContainText('GOOGLE_BRIDGE_TIMEOUT',{timeout:25000});await expect(page.locator('[data-dispatcher-action="authorize"]')).toBeEnabled();
});
