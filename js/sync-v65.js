/* Maister Tracker — consolidated sync (architecture-cleanup)
 * One owner for HMAC transport, ordered ticket writes, durable retry/delete,
 * shifts and bulk/cloud operations. No sync secret is ever placed in a URL.
 */
(() => {
  'use strict';
  const RELEASE='v65-sync-consolidated-4', MIN_SECRET=32;
  const GET_ACTIONS=new Set(['list','checkTicketExists','getTicketById']);
  const TICKET_ACTIONS=new Set(['addTicket','updateTicket','deleteTicket']);
  const chains=new Map();
  const shiftChains=new Map();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const utf8=s=>new TextEncoder().encode(String(s));
  const b64url=bytes=>{let bin='';const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);for(let i=0;i<a.length;i++)bin+=String.fromCharCode(a[i]);return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');};
  const nonce=()=>b64url(crypto.getRandomValues(new Uint8Array(18)));
  const secret=()=>String(settings?.syncHmacSecret||'').trim();
  async function hmac(c){if(secret().length<MIN_SECRET)throw new Error('HMAC_SECRET_MISSING_OR_SHORT');const k=await crypto.subtle.importKey('raw',utf8(secret()),{name:'HMAC',hash:'SHA-256'},false,['sign']);return b64url(await crypto.subtle.sign('HMAC',k,utf8(c)));}
  function endpoint(raw){try{const u=new URL(String(raw||''),location.href);if(u.protocol!=='https:')return'';u.search='';u.hash='';return u.href.replace(/\/$/,'');}catch(_){return'';}}
  const target=()=>{try{return endpoint(getScriptUrl());}catch(_){return'';}};
  const isTarget=raw=>!!target()&&endpoint(raw)===target();

  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:(input&&input.url)||'';
    if(!isTarget(raw))return nativeFetch(input,init);
    const method=String(init?.method||(input&&input.method)||'GET').toUpperCase();
    if(secret().length<MIN_SECRET)throw new Error('HMAC_SECRET_MISSING_OR_SHORT');
    if(method==='GET'){
      const u=new URL(raw,location.href);u.searchParams.delete('secret');
      const action=u.searchParams.get('action')||'list',id=u.searchParams.get('id')||'';
      if(!GET_ACTIONS.has(action))throw new Error('LEGACY_SYNC_GET_BLOCKED');
      for(const k of ['date','hours','coworker'])if(u.searchParams.has(k))throw new Error('LEGACY_SYNC_GET_BLOCKED');
      const ts=String(Date.now()),n=nonce(),sig=await hmac(`${ts}\n${n}\nGET\n${action}\n${id}`);
      u.searchParams.set('v','2');u.searchParams.set('ts',ts);u.searchParams.set('nonce',n);u.searchParams.set('sig',sig);
      return nativeFetch(u.href,init);
    }
    if(method==='POST'&&typeof init?.body==='string'){
      let data;try{data=JSON.parse(init.body);}catch(_){throw new Error('SYNC_BODY_INVALID');}
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('SYNC_BODY_INVALID');
      delete data.secret;
      const body=JSON.stringify(data),ts=String(Date.now()),n=nonce(),sig=await hmac(`${ts}\n${n}\nPOST\n${body}`);
      return nativeFetch(input,Object.assign({},init,{mode:'cors',body:JSON.stringify({v:2,ts,nonce:n,body,sig})}));
    }
    throw new Error('SYNC_METHOD_BLOCKED');
  };

  async function post(action,payload={}){
    const url=getScriptUrl();if(!url)return{ok:false,reason:'no-url'};
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{const res=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(Object.assign({action},payload)),signal:controller.signal,cache:'no-store'});if(!res.ok)return{ok:false,reason:`http-${res.status}`};const data=await res.json();return data&&data.status==='ok'?{ok:true,data}:{ok:false,reason:data?.message||'bad-response'};}catch(e){return{ok:false,reason:e?.name||String(e)};}finally{clearTimeout(timer);}
  }
  async function readState(action,id){
    const url=getScriptUrl();if(!url)return{ok:false,reason:'no-url'};const p=new URLSearchParams({action});if(id!=null)p.set('id',String(id));const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
    try{const res=await fetch(`${url}?${p}`,{method:'GET',cache:'no-store',signal:controller.signal});if(!res.ok)return{ok:false,reason:`http-${res.status}`};const data=await res.json();return data&&data.status!=='error'?{ok:true,data}:{ok:false,reason:data?.message||'bad-response'};}catch(e){return{ok:false,reason:e?.name||String(e)};}finally{clearTimeout(timer);}
  }
  async function verify(action,payload){
    await sleep(200);
    for(const delay of[0,350,800]){
      if(delay)await sleep(delay);
      if(action==='addTicket'||action==='deleteTicket'){
        const r=await readState('checkTicketExists',payload?.id);
        if(r.ok&&typeof r.data?.exists==='boolean'&&r.data.exists===(action==='addTicket'))return true;
      }else{
        const r=await readState('getTicketById',payload?.id);
        const matcher=typeof securitySyncVerifyStateMatches==='function'?securitySyncVerifyStateMatches:(typeof ticketStateMatchesPayload==='function'?ticketStateMatchesPayload:null);
        if(r.ok&&matcher&&matcher(r.data?.ticket,payload))return true;
      }
    }
    return false;
  }
  window.verifyTicketSyncedOnServer=verify;

  async function ticketWrite(action,payload){
    if(!TICKET_ACTIONS.has(String(action||''))||payload?.id==null)return false;
    const key=String(payload.id),prev=chains.get(key)||Promise.resolve();
    const job=prev.catch(()=>false).then(async()=>{
      /* Re-check intent only when this queued operation reaches the network.
       * This prevents an old add/update from resurrecting a ticket after the
       * user deleted it while an earlier request was still in flight. */
      if(action!=='deleteTicket'){
        const cur=tickets.find(t=>String(t.id)===key);
        const tomb=deletedTickets.some(t=>t?.pendingCloudDelete&&String(t.id)===key);
        if(!cur||tomb)return false;
      }
      const sent=await post(action,payload);if(!sent.ok)return false;
      return verify(action,payload);
    });
    const tracked=job.finally(()=>{if(chains.get(key)===tracked)chains.delete(key);});chains.set(key,tracked);return tracked;
  }

  /* All legacy ticket calls are routed through the one ordered owner. Bulk
   * operations are routed to the v2 endpoint instead of silently failing. */
  postToUrl=function(url,action,payload){
    if(!isTarget(url))return Promise.resolve(false);
    if(TICKET_ACTIONS.has(String(action||'')))return ticketWrite(action,payload);
    if(action==='syncAll')return post('syncAll',payload).then(r=>r.ok);
    if(action==='syncAllTickets')return post('syncAllTickets',payload).then(r=>r.ok);
    if(action==='syncAllShifts')return post('syncAllShifts',payload).then(r=>r.ok);
    if(action==='clearAll')return post('clearAll',payload).then(r=>r.ok);
    return Promise.resolve(false);
  };

  const hasDelete=id=>deletedTickets.some(t=>t?.pendingCloudDelete&&String(t.id)===String(id));
  const live=id=>tickets.find(t=>String(t.id)===String(id))||null;
  syncPendingCloudDelete=function(t){
    if(!t?.pendingCloudDelete||!deletedTickets.includes(t))return Promise.resolve(false);
    const key=String(t.id);if(cloudDeleteInFlight.has(key))return cloudDeleteInFlight.get(key);
    const job=(async()=>{
      /* Wait for any already-started add/update for this id. Then delete.
       * ticketWrite also appends to the same id chain, so ordering survives
       * rapid create -> edit -> delete and app-side retries. */
      const before=await readState('checkTicketExists',t.id);
      if(before.ok&&before.data?.exists===false&& !chains.has(key)){delete t.pendingCloudDelete;saveDeletedTickets();return true;}
      const ok=await ticketWrite('deleteTicket',{id:t.id});
      if(ok){delete t.pendingCloudDelete;saveDeletedTickets();return true;}
      const after=await readState('checkTicketExists',t.id);
      if(after.ok&&after.data?.exists===false){delete t.pendingCloudDelete;saveDeletedTickets();return true;}
      return false;
    })().finally(()=>{if(cloudDeleteInFlight.get(key)===job)cloudDeleteInFlight.delete(key);});
    cloudDeleteInFlight.set(key,job);return job;
  };

  retrySyncQueue=async function(){
    if(syncQueueBusy||!getScriptUrl())return;
    const dels=deletedTickets.filter(t=>t?.pendingCloudDelete),ids=new Set(dels.map(t=>String(t.id))),pending=tickets.filter(t=>!t.synced&&!ids.has(String(t.id)));
    if(!dels.length&&!pending.length)return;
    syncQueueBusy=true;
    const retryBtn=document.getElementById('syncQueueRetryBtn');if(retryBtn)retryBtn.disabled=true;
    try{
      /* Tombstones first: a deleted ticket must never be recreated by retry. */
      for(const t of dels){await syncPendingCloudDelete(t);saveDeletedTickets();}
      for(const snap of pending){
        const cur=live(snap.id);if(!cur||hasDelete(snap.id))continue;
        const action=cur.syncAction==='updateTicket'?'updateTicket':'addTicket';
        const payload=ticketToSyncPayload(cur),ok=await ticketWrite(action,payload),after=live(snap.id);
        if(after&&!hasDelete(snap.id)){after.synced=ok;if(ok)delete after.syncAction;saveTickets();}
      }
    }finally{syncQueueBusy=false;if(retryBtn)retryBtn.disabled=false;}
    renderTicketsScreen();
  };

  /* Replace the legacy GET shift adapter. Shift writes are ordered by id and
   * use the same authenticated POST endpoint as tickets. */
  syncShiftPostGet=function(action,payload){
    const mapped=action==='delete'?'deleteShift':action==='add'?'addShift':action;
    if(!['addShift','deleteShift'].includes(mapped)||payload?.id==null)return Promise.resolve(false);
    const key=String(payload.id),prev=shiftChains.get(key)||Promise.resolve();
    const job=prev.catch(()=>false).then(async()=>{
      const body=mapped==='deleteShift'?{id:payload.id}:{id:payload.id,date:payload.date,hours:payload.hours,coworker:payload.coworker};
      return (await post(mapped,body)).ok;
    });
    const tracked=job.finally(()=>{if(shiftChains.get(key)===tracked)shiftChains.delete(key);});shiftChains.set(key,tracked);return tracked;
  };
  window.syncShiftSecure=async function(action,shift){return syncShiftPostGet(action==='deleteShift'?'delete':'add',shift);};

  /* Cloud/bulk owners. Legacy loadFromCloud GETs are automatically HMAC-signed
   * by the fetch gate; all bulk writes now reach the v2 POST endpoint. */
  window.loadCloudStateSecure=async function(){const r=await readState('list');return r.ok?r.data:null;};
  window.syncAllSecure=async function(allTickets,allShifts){return(await post('syncAll',{tickets:allTickets||[],shifts:allShifts||[]})).ok;};
  window.syncAllTicketsSecure=async function(list){return(await post('syncAllTickets',{tickets:list||[]})).ok;};
  window.syncAllShiftsSecure=async function(list){return(await post('syncAllShifts',{shifts:list||[]})).ok;};
  window.clearAllSecure=async function(){return(await post('clearAll',{})).ok;};

  /* Network recovery: retry durable local work when connectivity returns.
   * Startup retry is delayed until the application has rendered once. */
  window.addEventListener('online',()=>{setTimeout(()=>retrySyncQueue(),250);});
  setTimeout(()=>{if(navigator.onLine)retrySyncQueue();},1200);

  window.MaisterSync=Object.freeze({release:RELEASE,post,readState,verify,ticketWrite,loadCloudState:window.loadCloudStateSecure,retry:retrySyncQueue});
})();
