/* Pure validation shared by the page, dedicated browser worker and tests. */
(function(root,factory){
  const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MTOfflineDownloadCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MAX_SIZE=2*1024**3; // Bounded single-region archive, not a planet download.
  function fail(code){throw new Error(code);}
  function publicUrl(value,base){
    let url;try{url=new URL(value,base);}catch(_e){fail('MANIFEST_URL');}
    const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!(loopback&&url.protocol==='http:'))||url.username||url.password||url.hash||url.search||url.hostname.endsWith('.r2.dev'))fail('MANIFEST_URL');
    return url;
  }
  function downloadUrl(value){
    let url;try{url=new URL(value);}catch(_e){fail('DOWNLOAD_URL');}
    const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if((url.protocol!=='https:'&&!(loopback&&url.protocol==='http:'))||url.username||url.password||url.hash||url.hostname.endsWith('.r2.dev'))fail('DOWNLOAD_URL');
    return url;
  }
  function text(value,max=240){return typeof value==='string'&&value.trim()&&value.length<=max&&!/[<>\u0000-\u001f]/.test(value);}
  function manifest(value,url,expectedId){
    if(!value||typeof value!=='object'||Array.isArray(value))fail('MANIFEST_INVALID');
    for(const key of ['id','title','version','source','license','attribution','updatedAt'])if(!text(value[key],key==='attribution'?1000:240))fail('MANIFEST_INVALID');
    if(value.id!==expectedId||!Number.isSafeInteger(value.size)||value.size<127||value.size>MAX_SIZE||!/^\d{4}-\d{2}-\d{2}(?:[.\-][a-zA-Z0-9]+)*$/.test(value.version)||!Number.isFinite(Date.parse(value.updatedAt)))fail('MANIFEST_INVALID');
    if(!/^[a-fA-F0-9]{64}$/.test(value.sha256||'')||!value.attribution.includes('© OpenStreetMap contributors'))fail('MANIFEST_INVALID');
    if(![value.minZoom,value.maxZoom,value.displayMaxZoom].every(Number.isInteger)||value.minZoom<0||value.maxZoom<value.minZoom||value.maxZoom>15||value.displayMaxZoom<value.maxZoom||value.displayMaxZoom>18)fail('MANIFEST_INVALID');
    publicUrl(url);
    // Opaque allowlisted object identity, never a permanent or signed URL.
    if(typeof value.downloadId!=='string'||!/^[a-zA-Z0-9_-]{1,120}$/.test(value.downloadId)||['file','url','downloadUrl'].some(key=>Object.prototype.hasOwnProperty.call(value,key)))fail('MANIFEST_INVALID');
    const etag=value.etag||'';if(etag&&(!/^"[^"\r\n]+"$/.test(etag)||etag.length>240))fail('MANIFEST_INVALID');
    return {id:value.id,title:value.title,version:value.version,source:value.source,license:value.license,attribution:value.attribution,downloadId:value.downloadId,file:value.downloadId+'.pmtiles',size:value.size,minZoom:value.minZoom,maxZoom:value.maxZoom,displayMaxZoom:value.displayMaxZoom,sha256:value.sha256.toLowerCase(),etag,updatedAt:value.updatedAt,sourceBuild:String(value.sourceBuild||value.version).slice(0,240)};
  }
  function requiredFree(size){
    // Reserve for browser housekeeping and existing application data, not a
    // staging copy: 1.25x archive + 250 decimal MB, at least 300 MB.
    return Math.ceil(Math.max(Number(size)*1.25+250000000,300000000));
  }
  function quota(estimate,size){
    const available=Number.isFinite(estimate?.quota)&&Number.isFinite(estimate?.usage)?Math.max(0,estimate.quota-estimate.usage):null;
    const required=requiredFree(size);return {available,required,enough:available===null?null:available>=required};
  }
  function sameDownload(j,m){return !!j&&j.mapId===m.id&&j.version===m.version&&j.sha256===m.sha256&&(j.downloadId===m.downloadId||j.legacyIdentity===true&&!j.downloadId)&&j.totalSize===m.size;}
  function grant(value,m,j,now=Date.now()){
    if(!value||!sameDownload({mapId:value.mapId,version:value.version,downloadId:value.downloadId,sha256:value.sha256,totalSize:value.size},m))fail('RESUME_MANIFEST_CHANGED');
    const url=downloadUrl(value.url).href,expiresAt=Date.parse(value.expiresAt);
    if(!Number.isFinite(expiresAt)||expiresAt>now+30*60*1000)fail('DOWNLOAD_URL');
    if(expiresAt<=now+5000)fail('DOWNLOAD_URL_EXPIRED');
    const etag=value.etag||'';
    if(etag&&(!/^"[^"\r\n]+"$/.test(etag)||etag.length>240))fail('RESUME_CHANGED');
    if((m.etag&&etag!==m.etag)||(j?.etag&&etag&&etag!==j.etag))fail('RESUME_CHANGED');
    return {url,expiresAt,etag};
  }
  function response(headers,status,start,m,j){
    if(status!==(start?206:200))fail(start?'RESUME_STATUS':'DOWNLOAD_STATUS');
    const etag=headers.get('ETag')||'',lastModified=headers.get('Last-Modified')||'';
    if((m.etag&&etag!==m.etag)||(j?.etag&&etag!==j.etag)||(!j?.etag&&j?.lastModified&&lastModified!==j.lastModified))fail('RESUME_CHANGED');
    const encoding=headers.get('Content-Encoding');if(encoding&&encoding!=='identity')fail('DOWNLOAD_ENCODING');
    if(start){
      const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers.get('Content-Range')||'');
      if(!match||Number(match[1])!==start||Number(match[2])!==m.size-1||Number(match[3])!==m.size)fail('RESUME_RANGE');
    }
    const length=headers.get('Content-Length');if(length!==null&&Number(length)!==m.size-start)fail('DOWNLOAD_LENGTH');
    if(etag&&(!/^"[^"\r\n]+"$/.test(etag)||etag.length>240))fail('RESUME_CHANGED');
    return {etag,lastModified};
  }
  function sections(h,size){
    if(h.specVersion!==3||h.tileType!==1||!Number.isInteger(h.minZoom)||!Number.isInteger(h.maxZoom)||h.minZoom<0||h.maxZoom>15||h.minZoom>h.maxZoom||![h.minLon,h.minLat,h.maxLon,h.maxLat].every(Number.isFinite)||h.minLon>=h.maxLon||h.minLat>=h.maxLat||h.minLon< -180||h.maxLon>180||h.minLat< -90||h.maxLat>90)fail('INTEGRITY_HEADER');
    let end=127;
    for(const [offset,length] of [['rootDirectoryOffset','rootDirectoryLength'],['jsonMetadataOffset','jsonMetadataLength'],['leafDirectoryOffset','leafDirectoryLength'],['tileDataOffset','tileDataLength']]){
      const at=h[offset],count=h[length];
      if(!Number.isSafeInteger(at)||!Number.isSafeInteger(count)||at<end||count<0||at+count>size)fail('INTEGRITY_SECTIONS');
      if(offset!=='leafDirectoryOffset'&&!count)fail('INTEGRITY_SECTIONS');end=at+count;
    }
  }
  return {manifest,publicUrl,downloadUrl,grant,requiredFree,quota,sameDownload,response,sections};
});
