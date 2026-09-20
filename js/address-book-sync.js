/* Stage 2D: phone AddressBook → Worker (/directory) → KV → AI.

   The local directory (settings.addressBook, Stage 2A) is the master's own
   accumulating list of cities/streets with permanent UUIDs. The AI backend
   (Cloudflare Worker) only ever saw Google Sheets rows, so aliases and streets
   without tickets were invisible to it. This module pushes a PROJECTION of the
   directory — id, cityId, name, aliases, active, updatedAt; no tickets, no
   clients — to the existing AI backend the PWA already talks to (same URL and
   bearer as /ask). The Worker stores it in KV next to the ticket snapshot and
   the READ tools resolve user text → name/alias → UUID from it.

   When: after every directory change (new street typed in the calculator,
   rename, alias, archive), debounced; at app start and when the network comes
   back if a push is still pending; and right before an AI question, so the
   assistant never answers from a directory older than the phone's. Nothing is
   pushed when AI is not configured. The last pushed fingerprint lives in
   localStorage (device-local, never in backups). */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTAddressBookSync=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION=1;
  const STORAGE_KEY='mt_directory_sync_v1';
  const DEBOUNCE_MS=2500;
  const MAX_ALIASES=40;
  const str=value=>typeof value==='string'?value:'';
  const byId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;

  /* Exactly what leaves the phone. Archived entities are included (flag), so
     historical tickets stay resolvable on the AI side. */
  function projection(book){
    const cities=(book&&Array.isArray(book.cities)?book.cities:[]).filter(c=>c&&typeof c.id==='string'&&typeof c.name==='string').map(c=>({
      id:c.id,name:c.name,aliases:Array.isArray(c.aliases)?c.aliases.filter(a=>typeof a==='string').slice(0,MAX_ALIASES):[],
      active:c.active!==false,updatedAt:str(c.updatedAt)||str(c.createdAt)
    }));
    const streets=(book&&Array.isArray(book.streets)?book.streets:[]).filter(s=>s&&typeof s.id==='string'&&typeof s.cityId==='string'&&typeof s.name==='string').map(s=>({
      id:s.id,cityId:s.cityId,name:s.name,aliases:Array.isArray(s.aliases)?s.aliases.filter(a=>typeof a==='string').slice(0,MAX_ALIASES):[],
      active:s.active!==false,updatedAt:str(s.updatedAt)||str(s.createdAt)
    }));
    return {v:VERSION,cities,streets};
  }

  /* Order-independent change detector (FNV-1a over canonical JSON). Not a
     security primitive — it only decides whether a push is needed. */
  function fingerprint(payload){
    const canon=JSON.stringify({v:payload.v,cities:payload.cities.slice().sort(byId),streets:payload.streets.slice().sort(byId)});
    let hash=0x811c9dc5;
    for(let i=0;i<canon.length;i++){hash^=canon.charCodeAt(i);hash=Math.imul(hash,0x01000193)>>>0;}
    return ('00000000'+hash.toString(16)).slice(-8)+':'+canon.length;
  }

  /* deps: getBook() → settings.addressBook | null
           getConfig() → {ready:boolean, backendUrl, bearer}
           fetchImpl, storage (localStorage-like), now(), online() → boolean,
           setTimer/clearTimer (defaults: global timers), onStatus(status) */
  function createSyncer(deps){
    const storage=deps.storage||null;
    const now=deps.now||(()=>Date.now());
    const online=deps.online||(()=>true);
    const setTimer=deps.setTimer||((fn,ms)=>setTimeout(fn,ms));
    const clearTimer=deps.clearTimer||(id=>clearTimeout(id));
    const debounceMs=deps.debounceMs!=null?deps.debounceMs:DEBOUNCE_MS;
    let timer=null,inflight=null,lastError=null;

    function readState(){
      if(!storage)return {};
      try{const raw=storage.getItem(STORAGE_KEY);const parsed=raw?JSON.parse(raw):null;return parsed&&typeof parsed==='object'?parsed:{};}
      catch(_error){return {};}
    }
    function writeState(state){
      if(!storage)return;
      try{storage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(_error){}
    }
    function notify(){ if(typeof deps.onStatus==='function'){try{deps.onStatus(status());}catch(_error){}} }

    function current(){
      const book=deps.getBook();
      if(!book)return null;
      const payload=projection(book);
      return {payload,fingerprint:fingerprint(payload)};
    }

    /* pending = the phone's directory differs from what this backend received */
    function status(){
      const config=deps.getConfig()||{};
      const state=readState();
      const snapshot=current();
      const pushedHere=!!(snapshot&&state.fingerprint===snapshot.fingerprint&&state.backendUrl===config.backendUrl);
      return {
        configured:!!config.ready,
        pending:!!(snapshot&&!pushedHere),
        pushedAt:pushedHere?(state.pushedAt||null):null,
        lastPushedAt:state.pushedAt||null,
        cities:snapshot?snapshot.payload.cities.length:0,
        streets:snapshot?snapshot.payload.streets.length:0,
        inflight:!!inflight,
        lastError
      };
    }

    async function flush(options){
      const force=!!(options&&options.force);
      if(inflight)return inflight;
      inflight=(async()=>{
        const config=deps.getConfig()||{};
        if(!config.ready||!config.backendUrl||!config.bearer)return {ok:false,reason:'not_configured'};
        const snapshot=current();
        if(!snapshot)return {ok:false,reason:'no_directory'};
        const state=readState();
        if(!force&&state.fingerprint===snapshot.fingerprint&&state.backendUrl===config.backendUrl)return {ok:true,skipped:true};
        if(!online())return {ok:false,reason:'offline'};
        const controller=typeof AbortController==='function'?new AbortController():null;
        const timeoutMs=options&&options.timeoutMs?options.timeoutMs:15000;
        const timeout=controller?setTimer(()=>controller.abort(),timeoutMs):null;
        try{
          const response=await deps.fetchImpl(config.backendUrl+'/directory',{
            method:'POST',
            headers:{'Content-Type':'application/json','Authorization':'Bearer '+config.bearer},
            body:JSON.stringify(snapshot.payload),
            signal:controller?controller.signal:undefined
          });
          let body=null;
          try{body=await response.json();}catch(_error){body=null;}
          if(!response.ok||!body||body.ok!==true){
            lastError=response.status===401?'auth':response.status===503?'unavailable':response.status===429?'rate_limit':'http_'+response.status;
            return {ok:false,reason:lastError,status:response.status};
          }
          lastError=null;
          writeState({fingerprint:snapshot.fingerprint,pushedAt:now(),backendUrl:config.backendUrl,cities:body.cities,streets:body.streets});
          return {ok:true,cities:body.cities,streets:body.streets};
        }catch(error){
          lastError=error&&error.name==='AbortError'?'timeout':'network';
          return {ok:false,reason:lastError};
        }finally{
          if(timeout!=null)clearTimer(timeout);
        }
      })();
      try{return await inflight;}
      finally{inflight=null;notify();}
    }

    /* Called after every directory change: cheap fingerprint compare, then a
       debounced push (a burst of edits becomes one request). */
    function schedule(){
      const config=deps.getConfig()||{};
      if(!config.ready)return false;
      const snapshot=current();
      if(!snapshot)return false;
      const state=readState();
      if(state.fingerprint===snapshot.fingerprint&&state.backendUrl===config.backendUrl)return false;
      if(timer!=null)clearTimer(timer);
      timer=setTimer(()=>{timer=null;flush().catch(()=>{});},debounceMs);
      notify();
      return true;
    }

    /* App start / network back: push only when something is pending. */
    function boot(){
      const info=status();
      if(!info.configured||!info.pending)return false;
      if(timer!=null)clearTimer(timer);
      timer=setTimer(()=>{timer=null;flush().catch(()=>{});},Math.min(debounceMs,1500));
      return true;
    }

    /* Right before an AI question: bounded wait so the answer is never built
       from a directory older than the phone's; failures never block the chat. */
    async function beforeAsk(){
      const info=status();
      if(!info.configured||!info.pending)return {ok:true,skipped:true};
      if(timer!=null){clearTimer(timer);timer=null;}
      return flush({timeoutMs:6000});
    }

    return {status,flush,schedule,boot,beforeAsk,readState};
  }

  return {VERSION,STORAGE_KEY,DEBOUNCE_MS,projection,fingerprint,createSyncer};
});

/* ---- browser wiring (classic script globals; no-ops outside the PWA) ---- */
let mtDirectorySyncerInstance=null;
function mtDirectorySyncer(){
  if(mtDirectorySyncerInstance)return mtDirectorySyncerInstance;
  if(typeof window==='undefined'||typeof MTAddressBookSync==='undefined')return null;
  mtDirectorySyncerInstance=MTAddressBookSync.createSyncer({
    getBook:()=>(typeof settings!=='undefined'&&settings&&settings.addressBook)?settings.addressBook:null,
    getConfig:()=>{
      if(typeof MTAI==='undefined'||!MTAI.storage)return {ready:false};
      try{
        const ai=MTAI.storage.get();
        return {ready:MTAI.storage.isReady(),backendUrl:ai.backendUrl,bearer:MTAI.storage.bearer()};
      }catch(_error){return {ready:false};}
    },
    fetchImpl:(url,init)=>fetch(url,init),
    storage:(typeof localStorage!=='undefined')?localStorage:null,
    online:()=>(typeof navigator==='undefined'||navigator.onLine!==false),
    onStatus:()=>{ if(typeof mtAddressBookRenderSyncStatus==='function')mtAddressBookRenderSyncStatus(); }
  });
  return mtDirectorySyncerInstance;
}
function mtDirectorySyncSchedule(){ const syncer=mtDirectorySyncer(); return syncer?syncer.schedule():false; }
function mtDirectorySyncFlush(options){ const syncer=mtDirectorySyncer(); return syncer?syncer.flush(options):Promise.resolve({ok:false,reason:'unavailable'}); }
function mtDirectorySyncBoot(){ const syncer=mtDirectorySyncer(); return syncer?syncer.boot():false; }
function mtDirectorySyncBeforeAsk(){ const syncer=mtDirectorySyncer(); return syncer?syncer.beforeAsk():Promise.resolve({ok:true,skipped:true}); }
function mtDirectorySyncStatus(){ const syncer=mtDirectorySyncer(); return syncer?syncer.status():null; }
if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('online',()=>{ try{ mtDirectorySyncBoot(); }catch(_error){} });
}
