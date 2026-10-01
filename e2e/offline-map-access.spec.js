'use strict';
const {test,expect,gotoApp}=require('./app-test');
const {randomBytes}=require('node:crypto');
test('map access: encrypted per-phone credential survives reload, is hidden and deletion preserves local map',async({page,appEnv})=>{
  await page.setViewportSize({width:320,height:740});
  const token=randomBytes(32).toString('base64url');await gotoApp(page,appEnv.url);
  const open=async()=>{await page.click('.tab-btn[data-tab="tools"]');await page.locator('[data-tools-view="map"]').click();};
  await open();await page.locator('[data-tools-action="offline-download-token"]').click();
  await page.locator('#offlineMapTokenInput').fill(token);await page.locator('#offlineMapTokenSave').click();
  await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('✅ Доступ налаштовано');
  expect(await page.evaluate(t=>({local:Object.values(localStorage).some(v=>v.includes(t)),settings:JSON.stringify(settings).includes(t),ui:document.body.textContent.includes(t),overflow:document.documentElement.scrollWidth>innerWidth}),token)).toEqual({local:false,settings:false,ui:false,overflow:false});
  await page.reload();await page.waitForFunction(()=>window.__mtAppInitDone===true);await open();
  await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('✅ Доступ налаштовано');
  await page.locator('[data-tools-action="offline-download-token"]').click();await expect(page.locator('#offlineMapTokenInput')).toHaveValue('');
  await page.evaluate(()=>closeModal());
  await page.locator('[data-tools-action="offline-download-token-delete"]').click();
  await page.getByRole('button',{name:'Видалити',exact:true}).click();
  await expect(page.locator('#toolsOfflineDownloadCard')).not.toContainText('✅ Доступ налаштовано');
  await page.reload();await page.waitForFunction(()=>window.__mtAppInitDone===true);
  expect(await page.evaluate(()=>mtOfflineMapTokenGet())).toBe('');
});
test('map provider: only map bearer header, readable 401/429, no secret persistence',async({page,appEnv})=>{
  await gotoApp(page,appEnv.url);const token=randomBytes(32).toString('base64url');
  await page.evaluate(t=>mtOfflineMapTokenSet(t),token);
  let status=401;const requests=[];
  await page.route('https://maister-tracker-mcp.mastif1235.workers.dev/offline-map/grant',async route=>{
    requests.push({url:route.request().url(),headers:route.request().headers(),body:route.request().postData()});
    await route.fulfill({status,contentType:'application/json',body:'{}',headers:{'Access-Control-Allow-Origin':'*'}});
  });
  const grant=()=>page.evaluate(async()=>{try{await getOfflineMapDownloadUrl('dnipro-oblast','2026-09-30',{downloadId:'known',sha256:'hash',size:1});return 'unexpected';}catch(e){return e.message;}});
  expect(await grant()).toBe('DOWNLOAD_AUTH');status=429;expect(await grant()).toBe('DOWNLOAD_RATE_LIMIT');
  expect(requests).toHaveLength(2);for(const req of requests){expect(req.headers.authorization).toBe('Bearer '+token);expect(req.url).not.toContain(token);expect(req.body).not.toContain(token);}
  expect(await page.evaluate(t=>JSON.stringify(MTOfflineMap.readJournal()).includes(t),token)).toBe(false);
});
