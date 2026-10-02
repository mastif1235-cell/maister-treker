'use strict';
const {test,expect,gotoApp}=require('./app-test');
const {randomBytes}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
async function openSettings(page){
  await page.click('.tab-btn[data-tab="settings"]');
  if(await page.locator('#settingsHubBackBtn').isVisible())await page.locator('#settingsHubBackBtn').click();
  await page.locator('[data-settings-hub="data"]').click();
  await page.locator('#settingsHubContent details').filter({has:page.locator('#openOfflineMapSettingsBtn')}).locator('summary').click();
  await page.locator('#openOfflineMapSettingsBtn').click();await expect(page.locator('#toolsOfflineDownloadCard')).toBeVisible();
}
test('offline-map UX: main map has compact status only; full controls are in Settings at 320px',async({page,appEnv})=>{
  await page.setViewportSize({width:320,height:740});await gotoApp(page,appEnv.url);
  await page.click('.tab-btn[data-tab="tools"]');await page.locator('[data-tools-view="map"]').click();
  await expect(page.locator('#toolsOfflineDownloadCard')).toHaveCount(0);
  await expect(page.locator('#toolsOfflineMapCompactStatus')).toHaveText('Офлайн-карта не встановлена');
  await expect(page.locator('[data-tools-action="offline-download-token"]')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await openSettings(page);
  await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('Дніпропетровська область');
  await expect(page.locator('[data-tools-action="offline-download-token"]')).toBeVisible();
  await expect(page.locator('[data-tools-action="offline-download-start"]')).toBeVisible();
});
test('map access: shipped catalog loads public manifest and phone token enables download to signer at 320px',async({page,appEnv})=>{
  const manifestUrl='https://mastif1235-cell.github.io/maister-treker/docs/offline-maps/dnipro-oblast/manifest.json';
  const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/offline-maps/dnipro-oblast/manifest.json'),'utf8'));
  const token=randomBytes(32).toString('base64url'),grants=[];
  // Production Pages loads this URL under connect-src 'self'. The isolated
  // localhost fixture has another origin; permit only the exact Pages origin there.
  const html=path.join(appEnv.dir,'index.html');
  fs.writeFileSync(html,fs.readFileSync(html,'utf8').replace("connect-src 'self'","connect-src 'self' https://mastif1235-cell.github.io"));
  await page.route(manifestUrl,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(manifest),headers:{'Access-Control-Allow-Origin':'*'}}));
  await page.route('https://maister-tracker-mcp.mastif1235.workers.dev/offline-map/grant',async route=>{
    grants.push({authorization:route.request().headers().authorization,body:JSON.parse(route.request().postData())});
    // No real secrets or private R2 bytes in E2E; verify the exact download request and safe auth failure.
    await route.fulfill({status:401,contentType:'application/json',body:'{}',headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.setViewportSize({width:320,height:740});await gotoApp(page,appEnv.url);
  await openSettings(page);
  await page.waitForFunction(()=>MTOfflineDownloader.snapshot().manifest?.id==='dnipro-oblast',null,{timeout:30000});
  expect(await page.evaluate(()=>MTOfflineMapCatalog[0].manifestUrl)).toBe(manifestUrl);
  const card=page.locator('#toolsOfflineDownloadCard');
  await expect(card).toContainText('Дніпропетровська область');
  await expect(card).not.toContainText('Завантаження ще не налаштовано');
  await card.locator('[data-tools-action="offline-download-token"]').click();
  await page.locator('#offlineMapTokenInput').fill(token);await page.locator('#offlineMapTokenSave').click();
  await expect(card).toContainText('✅ Доступ налаштовано');
  const start=card.getByRole('button',{name:'Завантажити',exact:true});
  await expect(start).toBeVisible();await expect(start).toBeEnabled();await start.scrollIntoViewIfNeeded();
  expect(await start.evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await card.screenshot({path:test.info().outputPath('configured-map-download-320.png')});
  await start.click();
  await expect(card).toContainText('Немає доступу до карти. Введіть або замініть токен цього телефону.');
  expect(grants).toEqual([{authorization:'Bearer '+token,body:{mapId:manifest.id,version:manifest.version,downloadId:manifest.downloadId,sha256:manifest.sha256,size:manifest.size}}]);
  expect(await page.evaluate(t=>JSON.stringify(MTOfflineMap.readJournal()).includes(t)||document.body.textContent.includes(t),token)).toBe(false);
});
test('map access: encrypted per-phone credential survives reload, is hidden and deletion preserves local map',async({page,appEnv})=>{
  await page.setViewportSize({width:320,height:740});
  const token=randomBytes(32).toString('base64url');await gotoApp(page,appEnv.url);
  const open=()=>openSettings(page);
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
