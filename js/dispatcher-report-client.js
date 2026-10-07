/* Parallel dispatcher outbox. Persist ONLY operation metadata, never tickets,
   private text or credentials. A report failure never rejects a local save. */
(function(root){
  'use strict';
  const KEY='mtDispatcherReportOutboxV1',PERMANENT=/^(?:INVALID_|UNKNOWN_|PRIVACY_|HASH_|FORMULA_|STALE_|REPORT_SCHEMA|LEGACY_|DUPLICATE_)/;
  function endpoint(value){let url;try{url=new URL(String(value||''));}catch(_){throw new Error('INVALID_ENDPOINT');}if(url.protocol!=='https:'||url.hostname!=='script.google.com'||url.username||url.password||url.port||!/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)||url.search||url.hash)throw new Error('INVALID_ENDPOINT');return url.href;}
  function createOutbox(deps){
    let state={endpoint:'',operations:[],lastError:'',lastSuccess:''},running=false,timer=null,generation=0;
    try{const saved=JSON.parse(deps.storage.getItem(KEY)||'null');if(saved&&Array.isArray(saved.operations)&&saved.operations.length<=10000){state={...state,...saved};state.operations=saved.operations.filter(o=>o&&typeof o.id==='string'&&['upsert','delete'].includes(o.action)&&Number.isSafeInteger(o.version)&&Number.isInteger(o.attempts)&&o.attempts>=0&&o.attempts<=3).map(o=>({id:o.id,action:o.action,version:o.version,attempts:o.attempts,next:Number(o.next)||0,error:String(o.error||'')}));}}catch(_){state.lastError='LOCAL_QUEUE_UNAVAILABLE';}
    const now=()=>deps.now?.()??Date.now();
    function persist(){try{deps.storage.setItem(KEY,JSON.stringify(state));}catch(_){state.lastError='LOCAL_QUEUE_UNAVAILABLE';}deps.changed?.(status());}
    function status(){return {pending:state.operations.filter(o=>o.attempts<3&&!o.error).length,failed:state.operations.filter(o=>o.attempts>=3||o.error).length,lastError:state.lastError,lastSuccess:state.lastSuccess};}
    function schedule(ms=0){if(timer!==null)deps.clearTimeout(timer);timer=deps.setTimeout(()=>{timer=null;void flush();},ms);}
    function configured(){const c=deps.settings();return !!c.dispatcherReportEnabled&&!!c.dispatcherReportEndpoint;}
    function align(){const c=deps.settings(),url=endpoint(c.dispatcherReportEndpoint);if(url!==state.endpoint){generation++;state={endpoint:url,operations:[],lastError:'',lastSuccess:''};persist();}return url;}
    function enqueue(id,action){try{if(!configured())return false;align();id=String(id);const old=state.operations.find(o=>o.id===id),version=Math.max(now(),(old?.version||0)+1);state.operations=state.operations.filter(o=>o.id!==id);if(state.operations.length>=10000){state.lastError='REPORT_CAPACITY';persist();return false;}state.operations.push({id,action,version,attempts:0,next:0,error:''});persist();schedule();return true;}catch(e){state.lastError=e?.message==='INVALID_ENDPOINT'?'INVALID_ENDPOINT':'REPORT_QUEUE_ERROR';persist();return false;}}
    async function flush(){
      if(running||!configured()||deps.online?.()===false)return;
      running=true;let failed=false;
      try{
        const url=align(),g=generation,batch=state.operations.filter(o=>o.attempts<3&&!o.error&&o.next<=now()).slice(0,50);
        if(!batch.length)return;
        const dtos=[],deletes=[],sent=[];
        for(const o of batch){
          if(o.action==='delete'){deletes.push({ticket_id:o.id,source_version:o.version});sent.push(o);continue;}
          const ticket=deps.ticket(o.id);if(!ticket){state.operations=state.operations.filter(x=>x!==o);continue;}
          try{dtos.push(await deps.dto(ticket,o.version));sent.push(o);}catch(e){o.error=PERMANENT.test(e.code||e.message)?e.code||e.message:'INVALID_DTO';state.lastError=o.error;persist();}
        }
        if(!sent.length)return;
        const response=await deps.send(url,{action:'report_sync_all',tickets:dtos,deletes,request_id:deps.requestId(),rebuild:true});
        if(g!==generation||url!==deps.settings().dispatcherReportEndpoint)return;
        if(!response?.ok)throw new Error(response?.code||'REPORT_NETWORK_ERROR');
        const versions=new Map(sent.map(o=>[o.id,o.version]));state.operations=state.operations.filter(o=>versions.get(o.id)!==o.version);state.lastError='';state.lastSuccess=new Date(now()).toISOString();persist();
      }catch(e){
        failed=true;const code=String(e?.message||'REPORT_NETWORK_ERROR');state.lastError=/^[A-Z_]+$/.test(code)?code:'REPORT_NETWORK_ERROR';
        // No retry of privacy/schema failures. Bounded retries for transport,
        // consent, throttling and service failures, including across reload.
        for(const o of state.operations.filter(o=>o.attempts<3&&!o.error&&o.next<=now()).slice(0,50)){o.attempts++;if(PERMANENT.test(state.lastError))o.error=state.lastError;o.next=now()+[5000,30000,120000][o.attempts-1];}
        persist();
      }finally{
        running=false;const eligible=state.operations.filter(o=>o.attempts<3&&!o.error);if(eligible.length)schedule(Math.max(failed?5000:0,Math.min(...eligible.map(o=>o.next))-now()));
      }
    }
    function fullSync(){
      if(!configured())throw new Error('REPORT_NOT_CONFIGURED');align();
      const previous=new Map(state.operations.map(o=>[o.id,o])),live=deps.tickets();
      if(live.length>10000)throw new Error('REPORT_CAPACITY');
      const ids=new Set(live.map(t=>String(t.id))),version=now();
      const operations=state.operations.filter(o=>!ids.has(o.id)&&o.action==='delete');
      for(const t of live){const id=String(t.id);operations.push({id,action:'upsert',version:Math.max(version,(previous.get(id)?.version||0)+1),attempts:0,next:0,error:''});}
      if(operations.length>10000)throw new Error('REPORT_CAPACITY');state.operations=operations;persist();schedule();return status();
    }
    function retry(){for(const o of state.operations){o.attempts=0;o.next=0;o.error='';}state.lastError='';persist();schedule();}
    return Object.freeze({enqueueUpsert:t=>enqueue(t.id,'upsert'),enqueueDelete:id=>enqueue(id,'delete'),flush,fullSync,retry,status});
  }
  function createBridge(){
    let popup=null,peer=null,peerOrigin='',channel='',url='',ready=null,connected=false,resolveReady=null,rejectReady=null,readyTimer=null;
    const pending=new Map();
    function close(){popup?.close();popup=null;peer=null;url='';ready=null;connected=false;clearTimeout(readyTimer);rejectReady?.(new Error('REPORT_CONNECTION_RESET'));resolveReady=null;rejectReady=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('REPORT_CONNECTION_RESET'));}pending.clear();}
    window.addEventListener('message',e=>{
      const d=e.data;if(!d||d.channel!==channel||!popup||popup.closed)return;
      // Only the HtmlService child of THIS authenticated Google window may
      // complete the channel. No arbitrary Google window can become the peer.
      if(d.type==='MT_REPORT_BOOT'&&!peer){let host;try{const o=new URL(e.origin);host=o.protocol==='https:'&&(o.hostname==='script.google.com'||o.hostname.endsWith('.googleusercontent.com'));if(e.source?.top!==popup)return;}catch(_){return;}if(!host)return;peer=e.source;peerOrigin=e.origin;peer.postMessage({type:'MT_REPORT_HELLO',channel},peerOrigin);return;}
      if(e.source!==peer||e.origin!==peerOrigin)return;
      if(d.type==='MT_REPORT_READY'){clearTimeout(readyTimer);connected=true;resolveReady?.();return;}
      if(d.type==='MT_REPORT_RESPONSE'){const p=pending.get(d.id);if(p){clearTimeout(p.timer);pending.delete(d.id);p.resolve(d.result);}}
    });
    async function connect(value,interactive=false){
      const target=endpoint(value);if(url===target&&popup&&!popup.closed){if(connected)return;if(ready)return ready;}
      // A background local save must never open a window or demand consent.
      if(!interactive)throw new Error('GOOGLE_CONNECTION_REQUIRED');
      close();url=target;channel=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
      ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;readyTimer=setTimeout(()=>{ready=null;reject(new Error('GOOGLE_BRIDGE_TIMEOUT'));},20000);});
      const u=new URL(target);u.searchParams.set('origin',location.origin);u.searchParams.set('channel',channel);
      // Keep opener ONLY for this validated Google endpoint's nonce-pinned
      // postMessage bridge. No DTO or credential is placed in the URL.
      popup=window.MTDispatcherReportOpen(u.href);if(!popup){clearTimeout(readyTimer);rejectReady(new Error('GOOGLE_POPUP_BLOCKED'));const failed=ready;ready=null;return failed;}return ready;
    }
    async function send(value,request,interactive=false){await connect(value,interactive);const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('REPORT_NETWORK_ERROR'));},90000);pending.set(id,{resolve,reject,timer});peer.postMessage({type:'MT_REPORT_REQUEST',channel,id,request},peerOrigin);});}
    return {send,close,authorize:value=>connect(value,true)};
  }
  root.MTDispatcherReportClient=Object.freeze({createOutbox,endpoint});
  if(typeof document==='undefined')return;
  const bridge=createBridge(),cfg=()=>typeof settings==='object'?settings:{};
  const outbox=createOutbox({storage:localStorage,settings:cfg,tickets:()=>typeof tickets==='undefined'?[]:tickets,ticket:id=>typeof tickets==='undefined'?null:tickets.find(t=>String(t.id)===id),
    dto:async(t,v)=>(await import('./dispatcher-report-projection.mjs')).buildDTO(t,root.MTDispatcherReportCore,v),send:bridge.send,requestId:()=>crypto.randomUUID(),online:()=>navigator.onLine,
    // Browser timers require Window as receiver, not the dependency object.
    setTimeout:(fn,ms)=>window.setTimeout(fn,ms),clearTimeout:id=>window.clearTimeout(id),changed:()=>renderSettings()});
  function renderSettings(){const c=cfg(),u=document.getElementById('dispatcherReportEndpoint'),enable=document.getElementById('dispatcherReportEnabled'),s=document.getElementById('dispatcherReportStatus');if(u&&document.activeElement!==u)u.value=c.dispatcherReportEndpoint||'';if(enable)enable.checked=!!c.dispatcherReportEnabled;if(s){const x=outbox.status();s.textContent=`У черзі: ${x.pending}. Помилки: ${x.failed}.${x.lastSuccess?' Остання синхронізація: '+x.lastSuccess:''}${x.lastError?' Код: '+x.lastError:''}`;}}
  function message(text){const e=document.getElementById('dispatcherReportResult');if(e)e.textContent=text;}
  document.addEventListener('click',async event=>{
    const action=event.target.closest('[data-dispatcher-action]')?.dataset.dispatcherAction;if(!action)return;
    try{
      if(action==='save'){const value=document.getElementById('dispatcherReportEndpoint').value.trim();const enabled=document.getElementById('dispatcherReportEnabled').checked;const validated=value?endpoint(value):'';if(enabled&&!validated)throw new Error('REPORT_NOT_CONFIGURED');cfg().dispatcherReportEndpoint=validated;cfg().dispatcherReportEnabled=enabled;saveSettings();bridge.close();renderSettings();message('Окремі налаштування збережено. Стару синхронізацію не змінено.');return;}
      if(action==='authorize'){await bridge.authorize(cfg().dispatcherReportEndpoint);message('Google-підключення готове. Можна перевірити звіт або повторити чергу.');void outbox.flush();return;}
      if(action==='sync'){outbox.fullSync();message('Повна синхронізація поставлена в незалежну чергу.');return;}
      if(action==='retry'){outbox.retry();message('Повтор черги запущено.');return;}
      const response=await bridge.send(cfg().dispatcherReportEndpoint,{action:action==='rebuild'?'report_rebuild':'report_status',request_id:crypto.randomUUID()},true);
      if(!response?.ok)throw new Error(response?.code||'REPORT_NETWORK_ERROR');message(action==='rebuild'?'Видимий звіт перебудовано.':`Підключено. Активних нарядів: ${Number(response.active_count)||0}; видалених: ${Number(response.deleted_count)||0}.`);
    }catch(e){message('Звіт не відправлено. '+(/^[A-Z_]+$/.test(e?.message)?e.message:'REPORT_NETWORK_ERROR')+'. Локальні заявки та стара синхронізація не змінені.');}
  });
  window.addEventListener('online',()=>void outbox.flush());document.addEventListener('DOMContentLoaded',()=>{renderSettings();void outbox.flush();});
  root.MTDispatcherReport=Object.freeze({...outbox,renderSettings});
})(typeof globalThis==='object'?globalThis:this);
