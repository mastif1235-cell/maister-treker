/* Maister Tracker — consolidated sync (architecture-cleanup)
 * One owner for HMAC transport, ticket ordering, verification, delete repair,
 * shifts and cloud load. No sync secret is ever placed in a URL.
 */
(() => {
  'use strict';
  const RELEASE='v65-sync-consolidated-2', MIN_SECRET=32;
  const GET_ACTIONS=new Set(['list','checkTicketExists','getTicketById']);
  const chains=new Map();
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
      /* Reject legacy shift/query transport rather than leaking credentials. */
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
      return nativeFetch(input,Object.assign({},init,{body:JSON.stringify({v:2,ts,nonce:n,body,sig})}));
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
  async function verify(action,payload){await sleep(250);for(const delay of[0,450,1100]){if(delay)await sleep(delay);if(action==='addTicket'||action==='deleteTicket'){const r=await readState('checkTicketExists',payload?.id);if(r.ok&&typeof r.data?.exists==='boolean'&&r.data.exists===(action==='addTicket'))return true;}else{const r=await readState('getTicketById',payload?.id);const matcher=typeof securitySyncVerifyStateMatches==='function'?securitySyncVerifyStateMatches:(typeof ticketStateMatchesPayload==='function'?ticketStateMatchesPayload:null);if(r.ok&&matcher&&matcher(r.data?.ticket,payload))return true;}}return false;}
  window.verifyTicketSyncedOnServer=verify;

  /* Ticket writes use the legacy caller only as a UI/state adapter; network is HMAC. */
  const basePostToUrl=postToUrl;
  postToUrl=function(url,action,payload){if(!['addTicket','updateTicket','deleteTicket'].includes(String(action||''))||payload?.id==null)return basePostToUrl(url,action,payload);const key=String(payload.id),prev=chains.get(key)||Promise.resolve();const job=prev.catch(()=>false).then(()=>basePostToUrl(url,action,payload));const tracked=job.finally(()=>{if(chains.get(key)===tracked)chains.delete(key);});chains.set(key,tracked);return tracked;};
  const hasDelete=id=>deletedTickets.some(t=>t?.pendingCloudDelete&&String(t.id)===String(id));
  const live=id=>tickets.find(t=>String(t.id)===String(id))||null;
  syncPendingCloudDelete=function(t){if(!t?.pendingCloudDelete||!deletedTickets.includes(t))return Promise.resolve(false);const key=String(t.id);if(cloudDeleteInFlight.has(key))return cloudDeleteInFlight.get(key);const job=(async()=>{const before=await readState('checkTicketExists',t.id);if(before.ok&&before.data?.exists===false){delete t.pendingCloudDelete;saveDeletedTickets();return true;}const sent=await post('deleteTicket',{id:t.id});if(sent.ok){const confirmed=await verify('deleteTicket',{id:t.id});if(confirmed){delete t.pendingCloudDelete;saveDeletedTickets();return true;}}const after=await readState('checkTicketExists',t.id);if(after.ok&&after.data?.exists===false){delete t.pendingCloudDelete;saveDeletedTickets();return true;}return false;})().finally(()=>{if(cloudDeleteInFlight.get(key)===job)cloudDeleteInFlight.delete(key);});cloudDeleteInFlight.set(key,job);return job;};
  retrySyncQueue=async function(){if(syncQueueBusy||!getScriptUrl())return;const dels=deletedTickets.filter(t=>t?.pendingCloudDelete),ids=new Set(dels.map(t=>String(t.id))),pending=tickets.filter(t=>!t.synced&&!ids.has(String(t.id)));if(!dels.length&&!pending.length)return;syncQueueBusy=true;try{for(const t of dels){await syncPendingCloudDelete(t);saveDeletedTickets();}for(const snap of pending){const cur=live(snap.id);if(!cur||hasDelete(snap.id))continue;const action=cur.syncAction==='updateTicket'?'updateTicket':'addTicket',sent=await post(action,ticketToSyncPayload(cur)),ok=sent.ok&&await verify(action,ticketToSyncPayload(cur)),after=live(snap.id);if(after&&!hasDelete(snap.id)){after.synced=ok;if(ok)delete after.syncAction;}saveTickets();}}finally{syncQueueBusy=false;}renderTicketsScreen();};

  /* Shifts: POST only. The old GET query protocol is intentionally removed. */
  window.syncShiftSecure=async function(action,shift){if(!['addShift','deleteShift'].includes(action))return false;const payload=action==='deleteShift'?{id:shift?.id}:{id:shift?.id,date:shift?.date,hours:shift?.hours,coworker:shift?.coworker};return (await post(action,payload)).ok;};

  /* Cloud load: signed GET list, never ?secret=. */
  window.loadCloudStateSecure=async function(){const r=await readState('list');return r.ok?r.data:null;};

  /* Full operations use the same authenticated POST channel. */
  window.syncAllSecure=async function(allTickets,allShifts)=> (await post('syncAll',{tickets:allTickets||[],shifts:allShifts||[]})).ok;
  window.syncAllTicketsSecure=async list=> (await post('syncAllTickets',{tickets:list||[]})).ok;
  window.syncAllShiftsSecure=async list=> (await post('syncAllShifts',{shifts:list||[]})).ok;
  window.clearAllSecure=async()=> (await post('clearAll',{})).ok;

  window.MaisterSync=Object.freeze({release:RELEASE,post,readState,verify,loadCloudState:window.loadCloudStateSecure});
})();
