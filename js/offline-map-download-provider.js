/* Authenticated map-only grant. No R2 credentials, URLs in storage or logging. */
(function(root,factory){
  const create=factory();
  if(typeof module==='object'&&module.exports)module.exports=create;
  else if(typeof root.getOfflineMapDownloadUrl!=='function')root.getOfflineMapDownloadUrl=create(root);
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  return function create(root,{timeoutMs=15000}={}){
    return async function getOfflineMapDownloadUrl(mapId,version,options={}){
      const token=root.mtOfflineMapTokenGet?.();if(!token)throw new Error('DOWNLOAD_AUTH');
      const abort=new AbortController();let timedOut=false;
      const cancel=()=>abort.abort();
      if(options.signal?.aborted)throw new Error('STOPPED');
      options.signal?.addEventListener('abort',cancel,{once:true});
      const timer=setTimeout(()=>{timedOut=true;abort.abort();},timeoutMs);
      try{
        const response=await root.fetch('https://maister-tracker-mcp.mastif1235.workers.dev/offline-map/grant',{
          method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({mapId,version,downloadId:options.downloadId,sha256:options.sha256,size:options.size}),
          credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:abort.signal});
        if(response.status===401||response.status===403)throw new Error('DOWNLOAD_AUTH');
        if(response.status===429)throw new Error('DOWNLOAD_RATE_LIMIT');
        if(response.status!==200||!response.body)throw new Error('DOWNLOAD_GRANT');
        const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
        try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
          if(size>8192)throw new Error('DOWNLOAD_GRANT');text+=decoder.decode(part.value,{stream:true});}
          return JSON.parse(text+decoder.decode());
        }finally{await reader.cancel().catch(()=>{});}
      }catch(error){
        if(options.signal?.aborted)throw new Error('STOPPED');
        if(timedOut)throw new Error('DOWNLOAD_TIMEOUT');
        if(['DOWNLOAD_AUTH','DOWNLOAD_RATE_LIMIT','DOWNLOAD_GRANT'].includes(error.message))throw error;
        throw new Error('DOWNLOAD_NETWORK');
      }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel);}
    };
  };
});
