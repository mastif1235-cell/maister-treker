/* Dedicated BROWSER worker, not Cloudflare. Direct inactive-slot writes with
   SyncAccessHandle avoid createWritable's temporary swap/copy on resume. */
'use strict';
importScripts('offline-map-download-core.js','offline-map-sha256.js','../vendor/pmtiles/pmtiles.js');
let abort=null,stopped=false;
const core=MTOfflineDownloadCore;
const send=(type,value={})=>postMessage({type,...value});
const check=()=>{if(stopped)throw new DOMException('Stopped','AbortError');};

async function verify(file,m){
  if(file.size!==m.size)throw new Error('INTEGRITY_SIZE');
  // Read the completed OPFS file again in bounded chunks, off the main thread.
  // Hashing a fresh pass also handles reload/resume without trusting saved hash
  // state or hashing an unflushed/crash tail. Never buffer the entire archive.
  const hash=new MTOfflineSHA256();
  for(let at=0;at<file.size;at+=256*1024){
    check();hash.update(new Uint8Array(await file.slice(at,at+256*1024).arrayBuffer()));
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const sha256=hash.digest();if(sha256!==m.sha256)throw new Error('INTEGRITY_SHA256');
  const source=new pmtiles.FileSource(file),original=source.getBytes.bind(source);
  // Bound even malformed metadata/directory/tile requests. Valid regional
  // archives use small sections; fail closed instead of exhausting RAM.
  source.getBytes=(offset,length,...rest)=>{
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<=0||length>8*1024*1024||(offset+length>file.size&&!(offset===0&&length===16384)))throw new Error('INTEGRITY_READ');
    return original(offset,Math.min(length,file.size-offset),...rest);
  };
  const decompress=async(buffer,compression)=>{
    if(compression===1)return buffer;
    if(compression!==2)throw new Error('INTEGRITY_COMPRESSION');
    const reader=new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts=[];let size=0;
    try{for(;;){check();const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024)throw new Error('INTEGRITY_DECOMPRESS');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
    const result=new Uint8Array(size);let at=0;for(const part of parts){result.set(part,at);at+=part.length;}return result.buffer;
  };
  const archive=new pmtiles.PMTiles(source,new pmtiles.SharedPromiseCache(32,true,decompress),decompress),h=await archive.getHeader();core.sections(h,file.size);
  if(h.minZoom!==m.minZoom||h.maxZoom!==m.maxZoom||h.jsonMetadataLength>1024*1024)throw new Error('INTEGRITY_HEADER');
  const metadata=await archive.getMetadata(),layers=new Set((metadata.vector_layers||[]).map(layer=>layer.id));
  if(!['roads','buildings','places'].every(layer=>layers.has(layer)))throw new Error('INTEGRITY_SCHEMA');
  const samples=[];let directories=0;
  async function directory(offset,length,depth){
    check();if(depth>3||++directories>100000)throw new Error('INTEGRITY_DIRECTORY');
    const entries=await archive.cache.getDirectory(source,offset,length,h);
    if(!entries.length)throw new Error('INTEGRITY_DIRECTORY');
    let last=-1;
    for(const entry of entries){
      if(!Number.isSafeInteger(entry.tileId)||entry.tileId<=last||!Number.isSafeInteger(entry.offset)||entry.offset<0||!Number.isSafeInteger(entry.length)||entry.length<=0||!Number.isSafeInteger(entry.runLength)||entry.runLength<0)throw new Error('INTEGRITY_DIRECTORY');
      last=entry.tileId;
      if(entry.runLength){
        if(entry.offset+entry.length>h.tileDataLength)throw new Error('INTEGRITY_DIRECTORY');
        if(samples.length<6)samples.push(entry.tileId);
      }else{
        if(entry.offset+entry.length>h.leafDirectoryLength)throw new Error('INTEGRITY_DIRECTORY');
        await directory(h.leafDirectoryOffset+entry.offset,entry.length,depth+1);
      }
    }
  }
  await directory(h.rootDirectoryOffset,h.rootDirectoryLength,0);
  if(!samples.length)throw new Error('INTEGRITY_TILES');
  for(const id of samples){check();const [z,x,y]=pmtiles.tileIdToZxy(id),tile=await archive.getZxy(z,x,y);if(!tile?.data?.byteLength)throw new Error('INTEGRITY_TILES');}
  return {fileName:m.file,size:file.size,header:{specVersion:h.specVersion,tileType:h.tileType,minZoom:h.minZoom,maxZoom:h.maxZoom,minLon:h.minLon,minLat:h.minLat,maxLon:h.maxLon,maxLat:h.maxLat,centerLon:h.centerLon,centerLat:h.centerLat,centerZoom:h.centerZoom},sha256};
}
async function run(m,j,directoryName,downloadUrl){
  let handle=null,bytes=j.downloadedBytes,last=0,reader=null,result=null;
  let identity={etag:j.etag||'',lastModified:j.lastModified||''},phase='download';
  const checkpoint=()=>{
    handle?.flush();last=Date.now();send('checkpoint',{downloadedBytes:bytes,...identity});
  };
  try{
    const directory=await (await navigator.storage.getDirectory()).getDirectoryHandle(directoryName,{create:true});
    const fileHandle=await directory.getFileHandle(j.targetSlot,{create:true});
    if(typeof fileHandle.createSyncAccessHandle!=='function')throw new Error('OPFS_SYNC_UNAVAILABLE');
    handle=await fileHandle.createSyncAccessHandle();
    if(handle.getSize()<bytes)throw new Error('PARTIAL_MISSING');
    handle.truncate(bytes); // Discard only unjournalled crash tail, never active.
    check();
    if(bytes<m.size){
      const headers={};if(bytes){headers.Range=`bytes=${bytes}-`;if(j.etag)headers['If-Match']=j.etag;else if(j.lastModified)headers['If-Unmodified-Since']=j.lastModified;}
      let response;
      try{response=await fetch(core.downloadUrl(downloadUrl).href,{headers,signal:abort.signal,cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});}
      catch(error){if(error?.name==='AbortError')throw error;throw new Error('DOWNLOAD_NETWORK');}
      if(response.status===403)throw new Error('DOWNLOAD_URL_EXPIRED');
      identity=core.response(response.headers,response.status,bytes,m,j);
      if(!response.body)throw new Error('DOWNLOAD_BODY');
      checkpoint();reader=response.body.getReader();
      for(;;){
        check();const part=await reader.read();if(part.done)break;check();
        if(bytes+part.value.length>m.size)throw new Error('DOWNLOAD_LENGTH');
        // Some implementations deliver a large network chunk: write bounded
        // slices and cope with short writes without losing byte offsets.
        for(let at=0;at<part.value.length;){const slice=part.value.subarray(at,Math.min(at+256*1024,part.value.length));const wrote=handle.write(slice,{at:bytes});if(wrote<=0||wrote>slice.length)throw new Error('OPFS_WRITE');at+=wrote;bytes+=wrote;}
        if(Date.now()-last>=200)checkpoint();
      }
      if(bytes!==m.size)throw new Error('DOWNLOAD_INCOMPLETE');
    }
    checkpoint();handle.close();handle=null;check();phase='verify';send('verifying');
    const verified=await verify(await fileHandle.getFile(),m);check();result={type:'complete',verified};
  }catch(error){
    try{if(handle)checkpoint();}catch(_flushError){} // Never journal unflushed bytes.
    result={type:'paused',code:stopped?'STOPPED':phase!=='verify'&&error?.name==='TypeError'?'DOWNLOAD_NETWORK':String(error?.message||'DOWNLOAD_NETWORK'),broken:!stopped&&(phase==='verify'||String(error?.message||'').startsWith('INTEGRITY_'))};
  }finally{try{await reader?.cancel();}catch(_e){}try{handle?.close();}catch(_e){}abort=null;}
  // Signal terminal state only after releasing the OPFS writer. A quick Resume
  // or manual import must not race an access handle still being closed.
  if(result)send(result.type,result);
}
onmessage=event=>{
  if(event.data.type==='stop'){stopped=true;abort?.abort();return;}
  if(event.data.type==='start'&&!abort){stopped=false;abort=new AbortController();void run(event.data.manifest,event.data.journal,event.data.directory,event.data.downloadUrl);}
};
