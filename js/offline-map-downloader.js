/* Page controller: metadata publication and cross-tab writer lock. File bytes
   stay in the dedicated browser worker/OPFS, never in page state. */
(function(root,factory){
  const create=factory();if(typeof module==='object'&&module.exports)module.exports=create;else root.MTOfflineDownloader=create(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  return function create(root){
    const storage=root.MTOfflineMap,core=root.MTOfflineDownloadCore;
    const entry=()=>root.MTOfflineMapCatalog?.[0];
    let state={phase:storage.readJournal()?.broken?'broken':storage.readJournal()?'paused':'idle',manifest:null,message:'',quota:null};
    let worker=null,operation=null,manifestAbort=null,stopRequested=false,stopReason='STOPPED';
    const listeners=new Set();
    const snapshot=()=>({...state,active:storage.readMeta(),journal:storage.readJournal(),configured:!!entry()?.manifestUrl&&typeof root.getOfflineMapDownloadUrl==='function',busy:!!operation});
    const emit=patch=>{state={...state,...patch};for(const listener of listeners)listener(snapshot());};
    const supported=()=>!!(root.Worker&&root.navigator?.storage?.getDirectory&&root.navigator?.locks?.request);
    async function loadManifest(signal){
      const item=entry();if(!item?.manifestUrl)throw new Error('HOSTING_UNCONFIGURED');
      const url=core.publicUrl(item.manifestUrl).href;
      let response;
      try{response=await root.fetch(url,{cache:'no-store',credentials:'omit',redirect:'error',signal});}
      catch(error){if(error?.name==='AbortError')throw error;throw new Error('MANIFEST_UNAVAILABLE');}
      if(response.status!==200||!response.body)throw new Error('MANIFEST_UNAVAILABLE');
      const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
      try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32768)throw new Error('MANIFEST_INVALID');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
      let value;try{value=JSON.parse(text);}catch(_e){throw new Error('MANIFEST_INVALID');}
      return core.manifest(value,url,item.id);
    }
    async function refresh(){
      if(operation||!entry()?.manifestUrl)return snapshot();
      try{const manifest=await loadManifest();if(!operation)emit({manifest,message:''});}catch(error){if(!operation)emit({message:String(error.message)});}return snapshot();
    }
    async function getGrant(manifest,journal){
      if(typeof root.getOfflineMapDownloadUrl!=='function')throw new Error('HOSTING_UNCONFIGURED');
      let value;
      try{value=await root.getOfflineMapDownloadUrl(manifest.id,manifest.version,{downloadId:manifest.downloadId,sha256:manifest.sha256,size:manifest.size,signal:manifestAbort.signal});}
      catch(error){throw new Error(stopRequested?'STOPPED':['DOWNLOAD_AUTH','DOWNLOAD_RATE_LIMIT','DOWNLOAD_TIMEOUT','DOWNLOAD_NETWORK','DOWNLOAD_GRANT'].includes(error?.message)?error.message:'DOWNLOAD_AUTH');} // Never expose provider errors/URLs.
      if(stopRequested)throw new Error('STOPPED');
      return core.grant(value,manifest,journal);
    }
    function transfer(manifest,journal,grant){
      return new Promise((resolve,reject)=>{
        worker=new root.Worker(new URL('js/offline-map-download-worker.js',root.document.baseURI));
        let settled=false;
        const finish=(error,verified)=>{if(settled)return;settled=true;worker?.terminate();worker=null;error?reject(error):resolve(verified);};
        worker.onerror=()=>finish(new Error('DOWNLOAD_WORKER'));
        worker.onmessage=event=>{
          const data=event.data;
          try{
            if(data.type==='checkpoint'){
              if(!Number.isSafeInteger(data.downloadedBytes)||data.downloadedBytes<journal.downloadedBytes||data.downloadedBytes>manifest.size)throw new Error('DOWNLOAD_CHECKPOINT');
              journal={...journal,downloadedBytes:data.downloadedBytes,etag:data.etag,lastModified:data.lastModified,updatedAt:new Date().toISOString()};
              storage.writeJournal(journal);emit({phase:stopRequested?'stopping':'downloading'});
            }else if(data.type==='verifying')emit({phase:'verifying'});
            else if(data.type==='complete')finish(null,{verified:data.verified,journal});
            else if(data.type==='paused'){
              journal={...journal,broken:!!data.broken};storage.writeJournal(journal);
              emit({phase:data.broken?'broken':'paused',message:stopRequested?stopReason:data.code});finish(null,{paused:true,code:data.code,journal});
            }
          }catch(error){finish(error);}
        };
        worker.postMessage({type:'start',manifest,journal,directory:storage.DIRECTORY,downloadUrl:grant?.url});
        if(stopRequested)worker.postMessage({type:'stop'});
      });
    }
    async function perform(){
      if(!supported())throw new Error('DOWNLOAD_UNSUPPORTED');
      manifestAbort=new AbortController();emit({phase:'checking',message:'',quota:null});
      const manifest=await loadManifest(manifestAbort.signal);emit({manifest});
      if(stopRequested)throw new Error('STOPPED');
      let journal=storage.readJournal();
      if(journal?.broken)throw new Error('INTEGRITY_BROKEN');
      if(journal&&!core.sameDownload(journal,manifest))throw new Error('RESUME_MANIFEST_CHANGED');
      if(journal){
        // Upgrade pre-private PR journals only after exact version/hash/size
        // match. Never copy the old URL into the new persistent journal.
        const {url,legacyIdentity,...safe}=journal;journal={...safe,downloadId:manifest.downloadId};storage.writeJournal(journal);
      }
      const active=storage.readMeta();
      if(!journal&&active?.mapId===manifest.id&&active.version===manifest.version&&active.sha256===manifest.sha256){emit({phase:'ready',message:'ALREADY_CURRENT'});return;}
      let estimate=null;try{estimate=await root.navigator.storage.estimate?.();}catch(_e){}
      const quota=core.quota(estimate,manifest.size);emit({quota});
      if(quota.enough===false)throw new Error('DOWNLOAD_QUOTA');
      try{await root.navigator.storage.persist?.();}catch(_e){} // best effort, not a gate
      if(stopRequested)throw new Error('STOPPED');
      // Renew once on expiry/403. A persistent access denial pauses safely,
      // rather than looping or misclassifying the archive as broken.
      for(let attempt=0;attempt<2;attempt++){
        let grant=null;
        if(!journal||journal.downloadedBytes<manifest.size){
          try{grant=await getGrant(manifest,journal);}catch(error){if(error.message==='DOWNLOAD_URL_EXPIRED'&&attempt===0)continue;throw error;}
        }
        if(!journal){
          const now=new Date().toISOString();journal={mapId:manifest.id,version:manifest.version,downloadId:manifest.downloadId,totalSize:manifest.size,sha256:manifest.sha256,downloadedBytes:0,etag:manifest.etag||grant?.etag||'',lastModified:'',targetSlot:active?.activeSlot===storage.SLOTS[0]?storage.SLOTS[1]:storage.SLOTS[0],startedAt:now,updatedAt:now,completed:false};
          storage.writeJournal(journal);
        }
        if(grant?.etag&&!journal.etag){journal={...journal,etag:grant.etag};storage.writeJournal(journal);}
        emit({phase:'downloading'});
        const result=await transfer(manifest,journal,grant);journal=result.journal;
        if(result.paused){
          const maskedExpiry=result.code==='DOWNLOAD_NETWORK'&&root.navigator.onLine!==false&&journal.downloadedBytes>0&&grant&&Date.now()>=grant.expiresAt-30000;
          if(!stopRequested&&!journal.broken&&attempt===0&&(result.code==='DOWNLOAD_URL_EXPIRED'||maskedExpiry))continue;
          return;
        }
        if(!stopRequested){await storage.activateDownload(manifest,journal,result.verified);emit({phase:'ready',message:''});}
        else emit({phase:'paused',message:stopReason});
        return;
      }
    }
    function start(){
      if(operation)return operation;
      stopRequested=false;stopReason='STOPPED';
      operation=Promise.resolve().then(()=>storage.withWriteLock(perform)).catch(error=>{
        const journal=storage.readJournal();emit({phase:journal?.broken?'broken':journal?'paused':'idle',message:stopRequested?stopReason:String(error.message)});
      }).finally(()=>{worker?.terminate();worker=null;manifestAbort=null;operation=null;emit({});});
      return operation;
    }
    async function stop(reason='STOPPED'){
      stopReason=reason;stopRequested=true;if(operation)emit({phase:'stopping'});
      manifestAbort?.abort();worker?.postMessage({type:'stop'});
      if(operation)await operation;
    }
    async function discard(){await stop();await storage.discardPartial();emit({phase:'idle',message:''});}
    async function remove(){await stop();const ok=await storage.remove();emit({phase:'idle',message:ok?'':'DELETE_FAILED'});return ok;}
    // Chromium can keep an already-open HTTP connection streaming after an
    // offline event. Explicitly abort it and flush, not just future requests.
    root.addEventListener?.('offline',()=>{if(operation)void stop('DOWNLOAD_NETWORK');});
    return {snapshot,supported,refresh,start,stop,discard,remove,subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);}};
  };
});
