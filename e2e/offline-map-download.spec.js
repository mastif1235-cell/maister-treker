'use strict';
const {test,expect,gotoApp,waitServiceWorkerCacheReady}=require('./app-test');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {fixture}=require('../tests/helpers/offline-map-fixture');
async function provider(appEnv){
  const data=fixture(),requests=[];let manifest={...data.manifest},mode='normal',signatures=0;
  const server=http.createServer((req,res)=>{
    const cors={'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'ETag, Content-Range, Content-Length, Last-Modified','Cache-Control':'no-store'};
    if(req.method==='OPTIONS'){res.writeHead(204,{...cors,'Access-Control-Allow-Methods':'GET, HEAD','Access-Control-Allow-Headers':'Authorization, Range, If-Match, If-Unmodified-Since'}).end();return;}
    if(req.url==='/manifest.json'){res.writeHead(200,{...cors,'Content-Type':'application/json'}).end(JSON.stringify(manifest));return;}
    const requested=new URL(req.url,'http://localhost');
    if(requested.pathname==='/sign'){
      // TEST ONLY entitlement mock, not a production signer/auth mechanism.
      if(req.headers.authorization!=='Bearer test-authorized-user'){res.writeHead(401,cors).end();return;}
      const mapId=requested.searchParams.get('mapId'),version=requested.searchParams.get('version');
      if(mapId!==manifest.id||version!==manifest.version){res.writeHead(403,cors).end();return;}
      res.writeHead(200,{...cors,'Content-Type':'application/json'}).end(JSON.stringify({mapId,version,downloadId:manifest.downloadId,sha256:manifest.sha256,size:manifest.size,url:`${url}/fixture.pmtiles?X-Amz-Signature=mock-${++signatures}`,expiresAt:new Date(Date.now()+600000).toISOString(),etag:'"fixture-v1"'}));return;
    }
    if(requested.pathname!=='/fixture.pmtiles'||!requested.searchParams.has('X-Amz-Signature')){res.writeHead(403,cors).end();return;}
    const range=req.headers.range,start=range?Number(/^bytes=(\d+)-$/.exec(range)?.[1]):0;
    requests.push({range,start,ifMatch:req.headers['if-match'],signature:requested.searchParams.get('X-Amz-Signature')});
    if(mode==='expired'||mode==='403'){if(mode==='expired')mode='normal';res.writeHead(403,cors).end();return;}
    const status=range&&mode!=='200'?206:200,at=status===206?start:0;
    res.writeHead(status,{...cors,'ETag':mode==='etag'?'"other"':'"fixture-v1"','Content-Length':data.bytes.length-at,'Content-Type':'application/octet-stream',...(status===206?{'Content-Range':`bytes ${mode==='range'?start+1:start}-${data.bytes.length-1}/${data.bytes.length}`}:{})});
    let position=at;
    const timer=setInterval(()=>{
      if(position>=data.bytes.length){clearInterval(timer);res.end();return;}
      const end=Math.min(position+32768,data.bytes.length);res.write(data.bytes.subarray(position,end));position=end;
    },35);
    res.on('close',()=>clearInterval(timer));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const config=path.join(appEnv.dir,'js/offline-map-catalog.js');
  fs.writeFileSync(config,fs.readFileSync(config,'utf8').replace("manifestUrl:''",`manifestUrl:'${url}/manifest.json'`));
  fs.appendFileSync(config,`\n// Isolated test auth/provider; never shipped in production.\nwindow.getOfflineMapDownloadUrl=async(mapId,version,{signal})=>{const response=await fetch('${url}/sign?'+new URLSearchParams({mapId,version}),{headers:{Authorization:'Bearer test-authorized-user'},credentials:'omit',cache:'no-store',redirect:'error',signal});if(!response.ok)throw new Error('Not authorized');return response.json();};\n`);
  const html=path.join(appEnv.dir,'index.html');fs.writeFileSync(html,fs.readFileSync(html,'utf8').replace("connect-src 'self'",`connect-src 'self' ${url}`));
  return {requests,url,manifest:()=>manifest,setManifest:value=>{manifest={...manifest,...value};},setMode:value=>{mode=value;},close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
async function open(page){await page.click('.tab-btn[data-tab="tools"]');await page.locator('[data-tools-view="map"]').click();await expect(page.locator('#toolsOfflineDownloadCard')).toBeVisible();}
const click=(page,action)=>page.locator(`#toolsOfflineDownloadCard [data-tools-action="offline-download-${action}"]`).click();
async function waitReady(page){await page.waitForFunction(()=>MTOfflineDownloader.snapshot().phase==='ready'&&!MTOfflineDownloader.snapshot().busy,null,{timeout:30000});await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('✅ Офлайн-карта готова');}
async function confirmDelete(page,action){
  await click(page,action);await page.locator('#modalRoot').getByRole('button',{name:'Видалити',exact:true}).click();
}
for(const width of [320,360,390])test(`offline-map ${width}px: stream, stop, reload, Range resume, offline MapLibre, delete`,async({page,context,appEnv})=>{
  const p=await provider(appEnv);
  try{
    await page.setViewportSize({width,height:844});const errors=await gotoApp(page,appEnv.url);await waitServiceWorkerCacheReady(page);
    await page.evaluate(()=>{toolsNetworkPoints=[MTToolsCore.normalizeNetworkPoint({id:'offline-marker',name:'Офлайн-точка',type:'FOB',city:'Дніпро',lat:48.5,lng:34.5})];toolsSaveNetworkPoints();});await open(page);
    await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('Дніпропетровська область');
    await page.waitForFunction(()=>MTOfflineDownloader.snapshot().manifest!==null);
    await click(page,'start');
    await page.waitForFunction(()=>MTOfflineMap.readJournal()?.downloadedBytes>0);
    await expect(page.locator('#toolsOfflineDownloadBytes')).toContainText('%');await click(page,'stop');
    await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('Завантаження призупинено');
    const journal=await page.evaluate(()=>MTOfflineMap.readJournal());expect(journal.downloadedBytes).toBeGreaterThan(0);expect(journal.downloadedBytes).toBeLessThan(journal.totalSize);expect(journal.completed).toBe(false);
    const rawJournal=await page.evaluate(()=>localStorage.getItem(MTOfflineMap.JOURNAL_KEY));expect(rawJournal).not.toContain('X-Amz');expect(rawJournal).not.toContain('test-authorized-user');expect(journal.url).toBeUndefined();
    // Progress must not remount the map. A DOM sentinel survives chunks/stop.
    await page.evaluate(()=>document.getElementById('toolsLeafletMap').dataset.sentinel='kept');
    await page.reload();await page.waitForFunction(()=>window.__mtAppInitDone===true);await open(page);
    await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('Продовжити');
    const resume=await page.evaluate(()=>MTOfflineMap.readJournal());expect(resume.downloadedBytes).toBe(journal.downloadedBytes);
    await page.evaluate(()=>document.getElementById('toolsLeafletMap').dataset.sentinel='kept');
    await click(page,'start');await waitReady(page);
    expect(p.requests.at(-1).range).toBe(`bytes=${resume.downloadedBytes}-`);expect(p.requests.at(-1).ifMatch).toBe('"fixture-v1"');
    expect(p.requests.at(-1).signature).not.toBe(p.requests[0].signature);
    expect(await page.locator('#toolsLeafletMap').getAttribute('data-sentinel')).toBe('kept');
    const meta=await page.evaluate(()=>MTOfflineMap.readMeta());expect(meta.completed).toBe(true);expect(meta.sha256).toBe(p.manifest().sha256);
    await page.locator('#toolsOfflineDownloadCard').screenshot({path:test.info().outputPath(`offline-map-${width}.png`)});
    const cached=await page.evaluate(async()=>{const urls=(await Promise.all((await caches.keys()).map(async key=>(await (await caches.open(key)).keys()).map(r=>r.url)))).flat();return urls.filter(url=>new URL(url).pathname.endsWith('.pmtiles')||url.includes('X-Amz-Signature')||url.includes('/manifest.json')&&!url.endsWith(location.origin+'/manifest.json'));});expect(cached).toEqual([]);
    await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.__mtAppInitDone===true);await open(page);
    await page.locator('#toolsOfflineDownloadCard [data-tools-action="open-offline-map"]').click();
    await page.waitForFunction(()=>window.MTToolsMapLibreAdapter?.getMap()?.getStyle()?.sources?.['mt-offline']?.url?.startsWith('pmtiles://'));
    await page.waitForFunction(()=>MTToolsMapLibreAdapter.getMap().getStyle()?.sources?.['mt-objects']?.data?.features?.some(f=>f.properties.label==='Офлайн-точка'),null,{timeout:15000});
    expect(await page.evaluate(()=>MTToolsMapLibreAdapter.getMap().getMaxZoom())).toBe(18);
    await page.evaluate(()=>MTToolsMapLibreAdapter.getMap().jumpTo({center:[34.5,48.5],zoom:19}));
    await page.waitForFunction(()=>MTToolsMapLibreAdapter.getMap().getZoom()===18);
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const buttonHeights=await page.locator('#toolsOfflineDownloadCard .btn').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().height));expect(buttonHeights.every(h=>h>=44)).toBe(true);
    await confirmDelete(page,'delete');await expect(page.locator('#toolsOfflineDownloadCard')).not.toContainText('✅ Офлайн-карта готова');
    expect(await page.evaluate(async()=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle(MTOfflineMap.DIRECTORY);return {files:Array.fromAsync?await Array.fromAsync(dir.keys()):await (async()=>{const files=[];for await(const name of dir.keys())files.push(name);return files;})(),meta:MTOfflineMap.readMeta(),journal:MTOfflineMap.readJournal()};})).toEqual({files:[],meta:null,journal:null});
    expect(errors).toEqual([]);
  }finally{await p.close();}
});
test('offline-map: interrupted page reload resumes only the last flushed checkpoint, not a crash tail',async({page,appEnv})=>{
  const p=await provider(appEnv);
  try{
    await gotoApp(page,appEnv.url);await open(page);await click(page,'start');await page.waitForFunction(()=>MTOfflineMap.readJournal()?.downloadedBytes>0);
    await page.reload();await page.waitForFunction(()=>window.__mtAppInitDone===true);await open(page);
    const checkpoint=await page.evaluate(async()=>{
      const j=MTOfflineMap.readJournal(),dir=await (await navigator.storage.getDirectory()).getDirectoryHandle(MTOfflineMap.DIRECTORY),file=await dir.getFileHandle(j.targetSlot);
      const writable=await file.createWritable({keepExistingData:true});await writable.write({type:'write',position:j.downloadedBytes,data:new Uint8Array(17).fill(123)});await writable.close();return j.downloadedBytes;
    });
    await click(page,'start');await waitReady(page);expect(p.requests.at(-1).range).toBe(`bytes=${checkpoint}-`);
    expect(await page.evaluate(()=>MTOfflineMap.readMeta().sha256)).toBe(p.manifest().sha256);
  }finally{await p.close();}
});
test('offline-map: failed update preserves active slot; success switches A/B and deletes old; manual import survives',async({page,appEnv})=>{
  const p=await provider(appEnv);
  try{
    await gotoApp(page,appEnv.url);await open(page);await click(page,'start');await waitReady(page);
    const old=await page.evaluate(()=>MTOfflineMap.readMeta());
    p.setManifest({version:'2026-10-01',sha256:'a'.repeat(64)});await click(page,'start');
    await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('Не вдалося перевірити офлайн-карту',{timeout:30000});
    expect(await page.evaluate(()=>MTOfflineMap.readMeta())).toEqual(old);
    await confirmDelete(page,'discard');p.setManifest({sha256:old.sha256});await click(page,'start');await waitReady(page);
    const updated=await page.evaluate(()=>MTOfflineMap.readMeta());expect(updated.activeSlot).not.toBe(old.activeSlot);expect(updated.version).toBe('2026-10-01');
    expect(await page.evaluate(async name=>{const dir=await (await navigator.storage.getDirectory()).getDirectoryHandle(MTOfflineMap.DIRECTORY);try{await dir.getFileHandle(name);return true;}catch(_e){return false;}},old.activeSlot)).toBe(false);
    // Existing import owner/API installs the same valid local PMTiles file.
    const imported=await page.evaluate(async()=>{await MTMapAssets.loadPmtiles();const {file}=await MTOfflineMap.installed();return MTOfflineMap.install(file,null,{areaId:'legacy-area'});});expect(imported.areaId).toBe('legacy-area');
  }finally{await p.close();}
});
test('offline-map: unsafe resume responses never append; missing network preserves partial',async({page,context,appEnv})=>{
  const p=await provider(appEnv);
  try{
    await gotoApp(page,appEnv.url);await open(page);await click(page,'start');await page.waitForFunction(()=>MTOfflineMap.readJournal()?.downloadedBytes>0);await click(page,'stop');
    await page.waitForFunction(()=>!MTOfflineDownloader.snapshot().busy);
    const start=await page.evaluate(()=>MTOfflineMap.readJournal().downloadedBytes);
    for(const mode of ['200','range','etag']){
      p.setMode(mode);await click(page,'start');await page.waitForFunction(()=>!MTOfflineDownloader.snapshot().busy);
      expect(await page.evaluate(()=>MTOfflineMap.readJournal().downloadedBytes)).toBe(start);expect(await page.evaluate(()=>MTOfflineMap.readMeta())).toBe(null);
    }
    p.setMode('normal');await click(page,'start');await page.waitForFunction(value=>MTOfflineMap.readJournal()?.downloadedBytes>value,start);await context.setOffline(true);
    await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('Завантаження призупинено',{timeout:30000});
    expect(await page.evaluate(()=>MTOfflineMap.readJournal().downloadedBytes)).toBeGreaterThan(start);
  }finally{await p.close();}
});
test('offline-map: unconfigured hosting is honest and download is disabled',async({page,appEnv})=>{
  await gotoApp(page,appEnv.url);await open(page);await expect(page.locator('#toolsOfflineDownloadCard')).toContainText('Завантаження ще не налаштовано');await expect(page.locator('[data-tools-action="offline-download-start"]')).toBeDisabled();
});
test('offline-map: expired signed GET renews with fresh signature and same Range; repeated 403 pauses, never broken',async({page,appEnv})=>{
  const p=await provider(appEnv);
  try{
    expect((await fetch(p.url+'/sign?mapId=dnipro-oblast&version=2026-09-30')).status).toBe(401);
    expect((await fetch(p.url+'/fixture.pmtiles')).status).toBe(403);
    await gotoApp(page,appEnv.url);await open(page);await click(page,'start');await page.waitForFunction(()=>MTOfflineMap.readJournal()?.downloadedBytes>0);await click(page,'stop');await page.waitForFunction(()=>!MTOfflineDownloader.snapshot().busy);
    const checkpoint=await page.evaluate(()=>MTOfflineMap.readJournal().downloadedBytes);
    p.setMode('403');const before=p.requests.length;await click(page,'start');await page.waitForFunction(()=>!MTOfflineDownloader.snapshot().busy);
    expect(p.requests.length-before).toBe(2);expect(await page.evaluate(()=>MTOfflineMap.readJournal().broken)).toBe(false);expect(await page.evaluate(()=>MTOfflineMap.readJournal().downloadedBytes)).toBe(checkpoint);
    p.setMode('expired');await click(page,'start');await waitReady(page);
    const [expired,fresh]=p.requests.slice(-2);expect(expired.range).toBe(`bytes=${checkpoint}-`);expect(fresh.range).toBe(expired.range);expect(fresh.ifMatch).toBe('"fixture-v1"');expect(fresh.signature).not.toBe(expired.signature);
    expect(await page.evaluate(()=>MTOfflineMap.readMeta().sha256)).toBe(p.manifest().sha256);
  }finally{await p.close();}
});
