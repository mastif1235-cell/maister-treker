'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const core=require('../js/offline-map-download-core'),SHA=require('../js/offline-map-sha256'),create=require('../js/offline-map-downloader');
const {fixture}=require('./helpers/offline-map-fixture');
const base='https://maps.example.test/dnipro/manifest.json',data=fixture({size:32768});
const m=core.manifest(data.manifest,base,'dnipro-oblast');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
function workerContext(){
  const ctx={console,URL,Blob,File,Uint8Array,Uint32Array,DataView,TextDecoder,AbortController,DOMException,DecompressionStream,Date,setTimeout,postMessage(){}};ctx.globalThis=ctx;
  vm.createContext(ctx);ctx.importScripts=(...files)=>{for(const f of files)vm.runInContext(read(f.startsWith('../vendor/')?f.slice(3):'js/'+f),ctx);};
  vm.runInContext(read('js/offline-map-download-worker.js'),ctx);return ctx;
}
function controllerContext(){
  let active=null,journal=null,activation=0,fetches=0,instance=null;
  class Worker{
    constructor(){instance=this;}
    postMessage(message){if(message.type==='stop')this.message({type:'paused',code:'STOPPED',broken:false});}
    message(data){this.onmessage({data});}terminate(){}
  }
  const storage={DIRECTORY:'maps',SLOTS:['map-a.pmtiles','map-b.pmtiles'],readMeta:()=>active,readJournal:()=>journal,writeJournal:j=>{journal=j;},withWriteLock:async task=>task(),activateDownload:async(man,j,v)=>{activation++;active={...v,mapId:man.id,version:man.version,sha256:man.sha256,activeSlot:j.targetSlot};journal=null;},discardPartial:async()=>{journal=null;},remove:async()=>{active=null;journal=null;return true;}};
  const root={MTOfflineMap:storage,MTOfflineDownloadCore:core,MTOfflineMapCatalog:[{id:m.id,manifestUrl:base}],Worker,document:{baseURI:'https://app.example/'},navigator:{storage:{getDirectory(){},estimate:async()=>({quota:1e9,usage:0}),persist:async()=>false},locks:{request(){}}},fetch:async()=>{fetches++;return new Response(JSON.stringify(data.manifest));}};
  return {root,storage,get worker(){return instance;},get journal(){return journal;},get active(){return active;},get activation(){return activation;},get fetches(){return fetches;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  assert.equal(m.url,'https://maps.example.test/dnipro/fixture.pmtiles');
  for(const patch of [{size:0},{size:1.5},{version:''},{version:'latest'},{sha256:''},{maxZoom:16},{displayMaxZoom:19},{file:'https://other.test/map.pmtiles'},{file:'../map.pmtiles'},{attribution:'<script>© OpenStreetMap contributors</script>'}])assert.throws(()=>core.manifest({...data.manifest,...patch},base,m.id));
  assert.throws(()=>core.publicUrl('https://pub-test.r2.dev/map.pmtiles'));
  assert.equal(core.requiredFree(114207260),392759075);
  assert.equal(core.quota({quota:400000000,usage:100000000},114207260).enough,false);
  assert.equal(core.quota(null,m.size).enough,null);
  assert.equal(core.quota({quota:1e9,usage:0},m.size).enough,true);
  const headers=new Headers({'Content-Range':`bytes 100-${m.size-1}/${m.size}`,'ETag':'"v1"','Content-Length':String(m.size-100)});
  assert.equal(core.response(headers,206,100,m,{etag:'"v1"'}).etag,'"v1"');
  assert.throws(()=>core.response(headers,200,100,m,{}),/RESUME_STATUS/);
  assert.throws(()=>core.response(new Headers({'Content-Range':`bytes 99-${m.size-1}/${m.size}`}),206,100,m,{}),/RESUME_RANGE/);
  assert.throws(()=>core.response(headers,206,100,m,{etag:'"v2"'}),/RESUME_CHANGED/);
  assert.throws(()=>core.response(new Headers({'Content-Range':`bytes 100-${m.size-1}/${m.size-1}`}),206,100,m,{}),/RESUME_RANGE/);
  for(const size of [0,1,55,56,63,64,65,1000,1000000]){
    const bytes=crypto.randomBytes(size),hash=new SHA();for(let at=0;at<size;at+=37)hash.update(bytes.subarray(at,at+37));
    assert.equal(hash.digest(),crypto.createHash('sha256').update(bytes).digest('hex'),'streaming SHA '+size);
  }
  const w=workerContext(),valid=await w.verify(new File([data.bytes],'fixture.pmtiles'),m);assert.equal(valid.sha256,m.sha256);
  await assert.rejects(()=>w.verify(new File([data.bytes.subarray(0,100)],'fixture.pmtiles'),m),/INTEGRITY_SIZE/);
  await assert.rejects(()=>w.verify(new File([data.bytes],'fixture.pmtiles'),{...m,sha256:'a'.repeat(64)}),/INTEGRITY_SHA256/);
  const bad=fixture({size:32768,layers:['roads']});
  await assert.rejects(()=>w.verify(new File([bad.bytes],'fixture.pmtiles'),{...m,sha256:bad.manifest.sha256}),/INTEGRITY_SCHEMA/);
  const corrupted=Buffer.from(data.bytes);corrupted.writeBigUInt64LE(999999n,56);
  await assert.rejects(()=>w.verify(new File([corrupted],'fixture.pmtiles'),{...m,sha256:crypto.createHash('sha256').update(corrupted).digest('hex')}),/INTEGRITY_SECTIONS/);
  const ctx=controllerContext(),c=create(ctx.root);const events=[];c.subscribe(s=>events.push(s.phase));
  let run=c.start();await tick();assert.equal(ctx.journal.targetSlot,'map-a.pmtiles');
  ctx.worker.message({type:'checkpoint',downloadedBytes:100,etag:'"v1"',lastModified:''});
  assert.equal(ctx.journal.downloadedBytes,100);await c.stop();await run;assert.equal(c.snapshot().phase,'paused');
  const afterReload=create(ctx.root);assert.equal(afterReload.snapshot().phase,'paused');
  run=afterReload.start();await tick();assert.equal(ctx.journal.downloadedBytes,100);
  ctx.worker.message({type:'checkpoint',downloadedBytes:m.size,etag:'"v1"',lastModified:''});ctx.worker.message({type:'verifying'});ctx.worker.message({type:'complete',verified:valid});await run;
  assert.equal(ctx.active.activeSlot,'map-a.pmtiles');assert.equal(ctx.journal,null);assert.equal(ctx.activation,1);
  await afterReload.start();assert.equal(afterReload.snapshot().message,'ALREADY_CURRENT');assert.equal(ctx.activation,1);
  const old=ctx.active;ctx.root.fetch=async()=>new Response(JSON.stringify({...data.manifest,version:'2026-10-01'}));
  run=afterReload.start();await tick();assert.equal(ctx.journal.targetSlot,'map-b.pmtiles');
  ctx.worker.message({type:'paused',code:'INTEGRITY_SHA256',broken:true});await run;assert.equal(ctx.active,old);assert.equal(ctx.journal.broken,true);
  assert.equal(create(ctx.root).snapshot().phase,'broken');await afterReload.discard();assert.equal(ctx.active,old);
  assert.ok(events.includes('downloading'));assert.ok(events.includes('stopping'));assert.ok(events.includes('paused'));
  await afterReload.remove();assert.equal(ctx.active,null);
  ctx.root.MTOfflineMapCatalog[0].manifestUrl='';await afterReload.start();assert.equal(afterReload.snapshot().message,'HOSTING_UNCONFIGURED');
  console.log('PASS manifest, quota, HTTP resume guards, streaming SHA vectors, real PMTiles integrity, controller start/progress/stop/reload/update/delete');
})().catch(error=>{console.error(error);process.exitCode=1;});
