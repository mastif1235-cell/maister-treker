(function(root){
  'use strict';
  const DB_NAME='maisterTrackerSync'; const DB_VERSION=1; const STORE='journal'; const KEY='state-v1';
  function open(){
    return new Promise((resolve,reject)=>{ const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
  }
  async function transaction(mode, operation){ const db=await open(); return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,mode); const store=tx.objectStore(STORE); let result;
    try{ result=operation(store); }catch(error){db.close();reject(error);return;}
    tx.oncomplete=()=>{db.close();resolve(result);}; tx.onerror=()=>{db.close();reject(tx.error);}; tx.onabort=()=>{db.close();reject(tx.error||new Error('SYNC_JOURNAL_ABORTED'));};
  });}
  async function load(){ let request; await transaction('readonly',store=>{request=store.get(KEY);}); return request.result || {records:{}}; }
  async function save(state){ await transaction('readwrite',store=>store.put(state,KEY)); return state; }
  root.MTSyncJournalStorage={DB_NAME,DB_VERSION,STORE,KEY,load,save};
})(typeof globalThis!=='undefined'?globalThis:this);
