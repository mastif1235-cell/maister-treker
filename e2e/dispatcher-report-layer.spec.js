'use strict';
const {test,expect,gotoApp}=require('./app-test');
test('partial dispatcher ACK isolates stale item, receipts and expanded diagnostics',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  const result=await page.evaluate(async()=>{
    let raw=null;
    const list=[{id:'stale'},{id:'valid-2650'},{id:'valid-third'}];
    const q=MTDispatcherReportClient.createOutbox({storage:{getItem:()=>raw,setItem:(_k,v)=>{raw=v;}},settings:()=>({dispatcherReportEndpoint:'https://script.google.com/macros/s/synthetic/exec',dispatcherReportEnabled:false}),now:()=>1000,requestId:()=>'synthetic-request',tickets:()=>list,ticket:id=>list.find(t=>t.id===id),dto:async(t,v)=>({ticket_id:t.id,source_version:v}),setTimeout:()=>1,clearTimeout:()=>{},send:async(_u,r)=>({ok:true,code:'PARTIAL',items:r.tickets.map(t=>({ticket_id:t.ticket_id,source_version:t.source_version,action:'upsert',status:t.ticket_id==='stale'?'stale_version':'synced',code:t.ticket_id==='stale'?'STALE_VERSION':'OK'}))})});
    for(const t of list)q.enqueueUpsert(t);await q.flush();
    const report=globalThis.MTDispatcherReport;
    globalThis.MTDispatcherReport={...report,delivery:id=>q.delivery(id)};
    const html=dispatcherFailureDetails({id:'stale',date:'10.10.2026',phone:'PRIVATE-PHONE',masterNote:'PRIVATE-NOTE'});
    globalThis.MTDispatcherReport=report;
    return {failed:q.status().failed,unresolved:q.status().unresolved,stale:q.delivery('stale'),good:q.delivery('valid-2650'),receipts:JSON.parse(raw).receipts.length,html};
  });
  expect(result.failed).toBe(1);expect(result.unresolved).toBe(1);expect(result.receipts).toBe(2);
  expect(result.stale.code).toBe('STALE_VERSION');expect(result.good.state).toBe('sent');
  for(const text of ['10.10.2026','STALE_VERSION','dispatcher','attempts'])expect(result.html).toContain(text);
  expect(result.html).not.toContain('PRIVATE-');expect(errors).toEqual([]);
});
test('report enqueue uses browser timers with the correct receiver',async({page,appEnv})=>{
  await gotoApp(page,appEnv.url);
  const result=await page.evaluate(()=>{
    settings.dispatcherReportEndpoint='https://script.google.com/macros/s/synthetic/exec';
    settings.dispatcherReportEnabled=true;
    let nativeError='';try{window.setTimeout.call({},()=>{},0);}catch(e){nativeError=e.name+': '+e.message;}
    const queued=MTDispatcherReport.enqueueUpsert({id:'report-native-timer-test'});
    const state=MTDispatcherReport.status();settings.dispatcherReportEnabled=false;
    return {queued,pending:state.pending,lastError:state.lastError,nativeError};
  });
  expect(result.nativeError).toContain('Illegal invocation');
  expect({queued:result.queued,pending:result.pending,lastError:result.lastError}).toEqual({queued:true,pending:1,lastError:''});
});
test('parallel dispatcher settings: endpoint validation, no secrets, legacy unchanged',async({page,appEnv})=>{
  const errors=await gotoApp(page,appEnv.url);
  await page.click('.tab-btn[data-tab="settings"]');
  await page.locator('[data-settings-hub="sync"]').click();
  // Settings hub can collapse category groups; inspect actual control instead
  // of depending on a particular group title in the navigation.
  await page.evaluate(()=>{const e=document.getElementById('dispatcherReportEndpoint');for(let p=e.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;});
  const legacy=await page.evaluate(()=>({url:settings.scriptUrl,shift:settings.shiftsScriptUrl,secret:settings.syncHmacSecret}));
  await page.locator('#dispatcherReportEndpoint').fill('https://example.com/exec');
  await page.locator('[data-dispatcher-action="save"]').click();await expect(page.locator('#dispatcherReportResult')).toContainText('INVALID_ENDPOINT');
  await page.locator('#dispatcherReportEndpoint').fill('https://script.google.com/macros/s/synthetic/exec');
  await page.locator('[data-dispatcher-action="save"]').click();await expect(page.locator('#dispatcherReportResult')).toContainText('налаштування збережено');
  await page.evaluate(()=>{
    settings.dispatcherReportEnabled=true;
    tickets.push({id:'test-disabled-report-badge',date:currentTicketDate,time:'12:00',type:'Ремонт',sum:0,payment:'Готівка',content:'TEST'});
    renderTicketsScreen();
  });
  expect(await page.locator('[data-dispatcher-ticket-status="test-disabled-report-badge"]').evaluate(el=>el.hidden)).toBe(false);
  // Saving auto-send OFF must hide a badge already mounted in an expanded
  // card, not merely omit it on the next complete card render.
  await page.locator('#dispatcherReportEnabled').uncheck();
  await page.locator('[data-dispatcher-action="save"]').click();
  expect(await page.locator('[data-dispatcher-ticket-status="test-disabled-report-badge"]').evaluate(el=>el.hidden)).toBe(true);
  expect(await page.evaluate(()=>({url:settings.scriptUrl,shift:settings.shiftsScriptUrl,secret:settings.syncHmacSecret}))).toEqual(legacy);
  await page.reload();await page.waitForFunction(()=>typeof settings==='object'&&!!window.MTDispatcherReport);
  expect(await page.evaluate(()=>settings.dispatcherReportEndpoint)).toBe('https://script.google.com/macros/s/synthetic/exec');
  expect(await page.evaluate(()=>settings.dispatcherReportEnabled)).toBe(false);
  expect(errors).toEqual([]);
});
test('browser DTO is privacy whitelist, local data unchanged, independent of legacy sync',async({page,appEnv})=>{
  await gotoApp(page,appEnv.url);
  const result=await page.evaluate(async()=>{
    const t={id:'report-e2e',date:'06.10.2026',time:'12:10',type:'Ремонт',city:'Тест',address:'Тестова 106, кв.29',sum:100,payment:'Готівка',equipment:[{label:'ONU',qty:1}],macAddress:'AA:BB:CC:DD:EE:FF',note:'Замінено ONU, geoLat: 48.45, geoLng: 35.05, signal -18 dBm, працює',masterNote:'PRIVATE-CANARY',phone:'PHONE-CANARY',geoLat:48.45,geoLng:35.05,signal:'-18'};
    const before=JSON.stringify(t),{buildDTO}=await import('/js/dispatcher-report-projection.mjs'),dto=await buildDTO(t,MTDispatcherReportCore);
    return{unchanged:JSON.stringify(t)===before,dto,fields:MTDispatcherReportCore.FIELDS};
  });
  expect(result.unchanged).toBe(true);expect(Object.keys(result.dto)).toEqual(result.fields);expect(result.dto.onu_used).toBe(1);expect(result.dto.onu_replacement).toBe(1);expect(result.dto.mac_onu).toBe('AA:BB:CC:DD:EE:FF');
  expect(result.dto.dispatcher_comment).toBe('Замінено ONU, працює');
  const payload=JSON.stringify(result.dto);for(const value of ['PRIVATE-CANARY','PHONE-CANARY','geoLat','geoLng','48.45','35.05','dBm'])expect(payload).not.toContain(value);
});
test('offline boot retains new modules and local save without report backend',async({page,context,appEnv})=>{
  await gotoApp(page,appEnv.url);await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!!window.MTDispatcherReportCore);
  const result=await page.evaluate(async()=>{const {buildDTO}=await import('/js/dispatcher-report-projection.mjs');const dto=await buildDTO({id:'offline-test',date:'06.10.2026',type:'Підключення',macAddress:'AA:BB:CC:DD:EE:FF',payment:'Безкоштовно',sum:0},MTDispatcherReportCore);return{quantity:dto.onu_used,enabled:settings.dispatcherReportEnabled};});
  expect(result.quantity).toBe(1);expect(result.enabled).toBe(false);
});
