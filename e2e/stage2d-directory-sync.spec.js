'use strict';
/* Stage 2D end-to-end (real browser, real app): the phone's AddressBook is
   pushed to the AI backend's /directory — once at start-up (never pushed
   before), again after a NEW street is typed into the calculator (the
   directory learns it and the push carries its UUID), not at all while nothing
   changed or while offline, and immediately when the network comes back. The
   backend is a Playwright route: the request bodies are what the Worker's
   /directory receives. */
const {test,expect,gotoApp,waitServiceWorkerCacheReady}=require('./app-test');

const BACKEND='https://maister-tracker-mcp-dev.mastif1235.workers.dev';
const TOKEN='pwa:mt_e2e_token_0123456789abcdef0123456789abcdef:read';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('Stage 2D: AddressBook → /directory push at boot, after a new street, never twice for the same directory, offline-safe',async({page,context,appEnv})=>{
  const pushes=[];
  await context.route(BACKEND+'/**',async route=>{
    const request=route.request();
    const url=new URL(request.url());
    if(url.pathname==='/directory'&&request.method()==='POST'){
      const body=JSON.parse(request.postData()||'{}');
      pushes.push({body,auth:request.headers()['authorization']||''});
      return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,cities:body.cities.length,streets:body.streets.length,dropped:0,saved_at:new Date().toISOString()})});
    }
    if(url.pathname==='/healthz')return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,service:'maister-tracker-mcp',read_only:true})});
    if(url.pathname==='/ai/config')return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,mode:'read-only',auth_required:true,ask_configured:true,default_provider:'deepseek',version:2,providers:[]})});
    return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type, Authorization'}});
  });
  await page.addInitScript(([backend,token])=>{
    if(!localStorage.getItem('settings'))localStorage.setItem('settings',JSON.stringify({
      cities:['Шевченко','Таромське'],streets:{'Шевченко':['Вул Шевченко'],'Таромське':['Вул Привокзальна']},
      ai:{enabled:true,provider:'deepseek',model:'deepseek-flash',backendUrl:backend,backendMode:'shared',showInTools:true},
      aiBearerToken:token
    }));
  },[BACKEND,TOKEN]);
  const errors=await gotoApp(page,appEnv.url);
  await waitServiceWorkerCacheReady(page);

  /* 1) first start with AI configured: the migrated directory is pushed once */
  await expect.poll(()=>pushes.length,{timeout:20_000}).toBeGreaterThanOrEqual(1);
  const book=await page.evaluate(()=>settings.addressBook);
  const first=pushes[0];
  expect(first.auth).toBe('Bearer mt_e2e_token_0123456789abcdef0123456789abcdef');
  expect(first.body.v).toBe(1);
  expect(first.body.cities.map(c=>c.name).sort()).toEqual(['Таромське','Шевченко']);
  expect(first.body.streets.map(s=>s.name).sort()).toEqual(['Вул Привокзальна','Вул Шевченко']);
  expect(first.body.cities.map(c=>c.id).sort()).toEqual(book.cities.map(c=>c.id).sort());
  expect(first.body.streets.map(s=>s.id).sort()).toEqual(book.streets.map(s=>s.id).sort());
  for(const street of first.body.streets){
    expect(street.id).toMatch(UUID);
    expect(book.cities.map(c=>c.id)).toContain(street.cityId);
    expect(Object.keys(street).sort()).toEqual(['active','aliases','cityId','id','name','updatedAt']);
  }
  expect(JSON.stringify(first.body)).not.toMatch(/clientName|phone|ticket|password/);
  const status=await page.evaluate(()=>mtDirectorySyncStatus());
  expect(status.configured).toBe(true);
  expect(status.pending).toBe(false);

  /* 2) a ticket on a street the directory does not know yet: the calculator
        lets the directory remember it, and the next debounced push carries the
        new street with its own permanent UUID */
  const before=pushes.length;
  await page.click('.tab-btn[data-tab="calculator"]');
  await expect(page.locator('#saveTicketBtn')).toBeVisible();
  await page.fill('#f_city','Таромське');
  await page.fill('#f_street','Вул Нова');
  await page.fill('#f_house','7');
  await page.fill('#f_client','Stage 2D client');
  await page.selectOption('#f_payment','Готівка');
  await page.click('#saveTicketBtn');
  await expect(page.locator('#toastRoot .toast',{hasText:'Заявку збережено'}).first()).toBeVisible({timeout:20_000});
  const created=await page.evaluate(()=>{const t=tickets.find(x=>x.clientName==='Stage 2D client');const entry=settings.addressBook.streets.find(s=>s.name==='Вул Нова');return {streetId:t.streetId,cityId:t.cityId,entryId:entry&&entry.id,entryCity:entry&&entry.cityId};});
  expect(created.entryId).toMatch(UUID);
  expect(created.streetId).toBe(created.entryId);
  await expect.poll(()=>pushes.length,{timeout:20_000}).toBe(before+1);
  const second=pushes[pushes.length-1].body;
  const pushedNew=second.streets.find(s=>s.name==='Вул Нова');
  expect(pushedNew).toBeTruthy();
  expect(pushedNew.id).toBe(created.entryId);
  expect(pushedNew.cityId).toBe(created.cityId);
  expect(second.streets.length).toBe(3);

  /* 3) nothing changed → a reload pushes nothing again */
  const afterNew=pushes.length;
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__mtAppInitDone===true);
  await page.waitForTimeout(3500);
  expect(pushes.length).toBe(afterNew);

  /* 4) settings show the status; the explicit button forces a push */
  await page.click('.tab-btn[data-tab="settings"]');
  await page.click('[data-settings-hub="address"]');
  await page.locator('#addressDirectorySync').evaluate(el=>el.closest('details').open=true);
  await expect(page.locator('#addressDirectorySync')).toContainText('Довідник для AI передано');
  await page.click('#addressDirectorySyncBtn');
  await expect(page.locator('#toastRoot .toast',{hasText:'Довідник передано'}).first()).toBeVisible({timeout:20_000});
  expect(pushes.length).toBe(afterNew+1);

  /* 5) offline edit (alias) is queued; the network coming back flushes it */
  await context.setOffline(true);
  const offlineBase=pushes.length;
  const tarom=book.cities.find(c=>c.name==='Таромське');
  await page.locator('#cityMgmtList').evaluate(el=>el.closest('details').open=true);
  await page.click(`[data-address-edit="cities"][data-address-id="${tarom.id}"]`);
  await page.fill('#addressBookAliases','Таромское');
  await page.click('#addressBookSave');
  await page.waitForTimeout(3500);
  expect(pushes.length).toBe(offlineBase);
  expect(await page.evaluate(()=>mtDirectorySyncStatus().pending)).toBe(true);
  await expect(page.locator('#addressDirectorySync')).toContainText('ще не передані');
  await context.setOffline(false);
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect.poll(()=>pushes.length,{timeout:20_000}).toBe(offlineBase+1);
  const withAlias=pushes[pushes.length-1].body.cities.find(c=>c.id===tarom.id);
  expect(withAlias.aliases).toEqual(['Таромское']);
  expect(await page.evaluate(()=>mtDirectorySyncStatus().pending)).toBe(false);
  expect(errors).toEqual([]);
});
