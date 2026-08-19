/* Maister Tracker — consolidated ticket sync (architecture-cleanup)
 * Replaces the versioned security-sync wrapper chain after migration.
 * One owner for: HMAC transport, per-ticket ordering, verification, delete repair.
 */
(() => {
  'use strict';

  const RELEASE = 'v65-sync-consolidated';
  const MIN_SECRET = 32;
  const GET_ACTIONS = new Set(['list','checkTicketExists','getTicketById']);
  const chains = new Map();

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const utf8 = s => new TextEncoder().encode(String(s));
  const b64url = bytes => {
    let bin=''; const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    for(let i=0;i<a.length;i++) bin+=String.fromCharCode(a[i]);
    return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
  };
  const nonce = () => b64url(crypto.getRandomValues(new Uint8Array(18)));
  const secret = () => String(settings?.syncHmacSecret || '').trim();

  async function hmac(canonical){
    if(secret().length < MIN_SECRET) throw new Error('HMAC_SECRET_TOO_SHORT');
    const key=await crypto.subtle.importKey('raw',utf8(secret()),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    return b64url(await crypto.subtle.sign('HMAC',key,utf8(canonical)));
  }

  function endpoint(raw){
    try{ const u=new URL(String(raw||''),location.href); if(u.protocol!=='https:') return ''; u.search='';u.hash='';return u.href.replace(/\/$/,''); }
    catch(_){ return ''; }
  }
  function ticketsEndpoint(){ try{return endpoint(getScriptUrl());}catch(_){return '';} }
  function isTarget(raw){ return !!ticketsEndpoint() && endpoint(raw)===ticketsEndpoint(); }
  function isTicketGet(raw){
    try{ const u=new URL(String(raw||''),location.href); const a=u.searchParams.get('action')||'list'; return GET_ACTIONS.has(a)&&!u.searchParams.has('date')&&!u.searchParams.has('hours')&&!u.searchParams.has('coworker'); }
    catch(_){ return false; }
  }

  /* Transport is installed once. */
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const raw=typeof input==='string'?input:(input&&input.url)||'';
    if(!isTarget(raw)) return nativeFetch(input,init);
    const method=String(init?.method||(input&&input.method)||'GET').toUpperCase();
    if(method==='GET'&&!isTicketGet(raw)) return nativeFetch(input,init);
    if(secret().length < MIN_SECRET) throw new Error(secret()?'HMAC_SECRET_TOO_SHORT':'HMAC_SECRET_MISSING');

    if(method==='GET'){
      const u=new URL(raw,location.href); u.searchParams.delete('secret');
      const action=u.searchParams.get('action')||'list', id=u.searchParams.get('id')||'', ts=String(Date.now()), n=nonce();
      const sig=await hmac(`${ts}\n${n}\nGET\n${action}\n${id}`);
      u.searchParams.set('v','2');u.searchParams.set('ts',ts);u.searchParams.set('nonce',n);u.searchParams.set('sig',sig);
      return nativeFetch(u.href,init);
    }
    if(method==='POST'&&typeof init?.body==='string'){
      let data; try{data=JSON.parse(init.body);}catch(_){return nativeFetch(input,init);}
      if(data&&typeof data==='object'&&!Array.isArray(data)){
        delete data.secret;
        const body=JSON.stringify(data), ts=String(Date.now()), n=nonce();
        const sig=await hmac(`${ts}\n${n}\nPOST\n${body}`);
        return nativeFetch(input,Object.assign({},init,{body:JSON.stringify({v:2,ts,nonce:n,body,sig})}));
      }
    }
    return nativeFetch(input,init);
  };

  async function readState(action,id){
    const url=getScriptUrl(); if(!url) return {ok:false,reason:'no-url'};
    const p=new URLSearchParams({action}); if(id!=null)p.set('id',String(id));
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),5000);
    try{
      const res=await fetch(`${url}?${p}`,{method:'GET',mode:'cors',cache:'no-store',signal:controller.signal});
      if(!res.ok)return {ok:false,reason:`http-${res.status}`};
      const data=await res.json(); if(!data||data.status==='error')return {ok:false,reason:data?.message||'bad-response'};
      return {ok:true,data};
    }catch(e){return {ok:false,reason:e?.name||String(e)};}finally{clearTimeout(timer);}
  }

  async function verify(action,payload){
    await sleep(250);
    for(const delay of [0,450,1100]){
      if(delay)await sleep(delay);
      if(action==='addTicket'||action==='deleteTicket'){
        const r=await readState('checkTicketExists',payload?.id);
        if(r.ok&&typeof r.data?.exists==='boolean'&&r.data.exists===(action==='addTicket')) return true;
      }else{
        const r=await readState('getTicketById',payload?.id);
        const matcher=typeof securitySyncVerifyStateMatches==='function'?securitySyncVerifyStateMatches:(typeof ticketStateMatchesPayload==='function'?ticketStateMatchesPayload:null);
        if(r.ok&&matcher&&matcher(r.data?.ticket,payload)) return true;
      }
    }
    return false;
  }
  window.verifyTicketSyncedOnServer=verify;

  /* Serialize mutation per stable ticket id. */
  const basePostToUrl=postToUrl;
  postToUrl=function(url,action,payload){
    if(!['addTicket','updateTicket','deleteTicket'].includes(String(action||''))||payload?.id==null) return basePostToUrl(url,action,payload);
    const key=String(payload.id), prev=chains.get(key)||Promise.resolve();
    const job=prev.catch(()=>false).then(()=>basePostToUrl(url,action,payload));
    const tracked=job.finally(()=>{if(chains.get(key)===tracked)chains.delete(key);});
    chains.set(key,tracked); return tracked;
  };

  const hasDelete=id=>deletedTickets.some(t=>t?.pendingCloudDelete&&String(t.id)===String(id));
  const live=id=>tickets.find(t=>String(t.id)===String(id))||null;

  /* Delete repair: server state is authoritative. */
  syncPendingCloudDelete=function(trashed){
    if(!trashed?.pendingCloudDelete||!deletedTickets.includes(trashed))return Promise.resolve(false);
    const key=String(trashed.id);
    if(cloudDeleteInFlight.has(key))return cloudDeleteInFlight.get(key);
    const job=(async()=>{
      const before=await readState('checkTicketExists',trashed.id);
      if(before.ok&&before.data?.exists===false){delete trashed.pendingCloudDelete;saveDeletedTickets();return true;}
      const posted=await syncPost('deleteTicket',{id:trashed.id});
      if(posted){delete trashed.pendingCloudDelete;saveDeletedTickets();return true;}
      const after=await readState('checkTicketExists',trashed.id);
      if(after.ok&&after.data?.exists===false){delete trashed.pendingCloudDelete;saveDeletedTickets();return true;}
      return false;
    })().finally(()=>{if(cloudDeleteInFlight.get(key)===job)cloudDeleteInFlight.delete(key);});
    cloudDeleteInFlight.set(key,job); return job;
  };

  retrySyncQueue=async function(){
    if(syncQueueBusy||!getScriptUrl())return;
    const deletes=deletedTickets.filter(t=>t?.pendingCloudDelete), deleteIds=new Set(deletes.map(t=>String(t.id)));
    const pending=tickets.filter(t=>!t.synced&&!deleteIds.has(String(t.id)));
    if(!deletes.length&&!pending.length)return;
    syncQueueBusy=true;
    try{
      for(const t of deletes){await syncPendingCloudDelete(t);saveDeletedTickets();}
      for(const snap of pending){
        const current=live(snap.id); if(!current||hasDelete(snap.id))continue;
        const action=current.syncAction==='updateTicket'?'updateTicket':'addTicket';
        const ok=await syncPost(action,ticketToSyncPayload(current));
        const after=live(snap.id); if(after&&!hasDelete(snap.id)){after.synced=ok;if(ok)delete after.syncAction;} saveTickets();
      }
    }finally{syncQueueBusy=false;}
    renderTicketsScreen();
  };

  window.MaisterSync=Object.freeze({release:RELEASE,readState,verify});
})();
