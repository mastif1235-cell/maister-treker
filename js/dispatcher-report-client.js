/* Parallel dispatcher outbox. Persist ONLY operation metadata, never tickets,
   private text or credentials. A report failure never rejects a local save. */
(function(root){
  'use strict';
  const KEY='mtDispatcherReportOutboxV1',PERMANENT=/^(?:INVALID_|UNKNOWN_|PRIVACY_|HASH_|FORMULA_|STALE_|REPORT_SCHEMA|LEGACY_|DUPLICATE_)/;
  const CONNECTION=/^(?:GOOGLE_\w+|REPORT_CONNECTION_RESET|REPORT_NOT_CONFIGURED|INVALID_ENDPOINT)$/;
  function endpoint(value){let url;try{url=new URL(String(value||''));}catch(_){throw new Error('INVALID_ENDPOINT');}if(url.protocol!=='https:'||url.hostname!=='script.google.com'||url.username||url.password||url.port||!/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)||url.search||url.hash)throw new Error('INVALID_ENDPOINT');return url.href;}
  function createOutbox(deps){
    let state={endpoint:'',operations:[],receipts:[],lastError:'',lastSuccess:''},running=false,timer=null,generation=0,blocked=false,flight=null;
    try{const saved=JSON.parse(deps.storage.getItem(KEY)||'null');if(saved&&Array.isArray(saved.operations)&&saved.operations.length<=10000){state={...state,...saved};state.operations=saved.operations.filter(o=>o&&typeof o.id==='string'&&['upsert','delete'].includes(o.action)&&Number.isSafeInteger(o.version)&&Number.isInteger(o.attempts)&&o.attempts>=0&&o.attempts<=3).map(o=>({id:o.id,action:o.action,version:o.version,attempts:o.attempts,next:Number(o.next)||0,error:String(o.error||'')}));}}catch(_){state.lastError='LOCAL_QUEUE_UNAVAILABLE';}
    const now=()=>deps.now?.()??Date.now();
    // Recover v91.88's per-ticket failures caused by ONE shared connection
    // failure. Keep all operation IDs/versions, never tickets or private DTOs.
    for(const o of state.operations)if(CONNECTION.test(o.error)||CONNECTION.test(state.lastError)){o.attempts=0;o.next=0;if(CONNECTION.test(o.error))o.error='';}
    state.receipts=(Array.isArray(state.receipts)?state.receipts:[]).filter(r=>r&&typeof r.id==='string'&&Number.isSafeInteger(r.version)).slice(-10000).map(r=>({id:r.id,version:r.version}));
    blocked=CONNECTION.test(state.lastError);
    function persist(){try{deps.storage.setItem(KEY,JSON.stringify({endpoint:state.endpoint,operations:state.operations,receipts:state.receipts,lastError:state.lastError,lastSuccess:state.lastSuccess}));}catch(_){state.lastError='LOCAL_QUEUE_UNAVAILABLE';}deps.changed?.(status());}
    function status(){return {pending:state.operations.filter(o=>o.attempts<3&&!o.error).length,failed:state.operations.filter(o=>o.attempts>=3||o.error).length,lastError:state.lastError,lastSuccess:state.lastSuccess,running,connectionRequired:blocked};}
    function schedule(ms=0){if(timer!==null)deps.clearTimeout(timer);timer=deps.setTimeout(()=>{timer=null;void flush();},ms);}
    // Checkbox controls AUTOMATIC enqueue, not explicit manual sync/retry.
    function configured(){return !!deps.settings().dispatcherReportEndpoint;}
    function align(){const c=deps.settings(),url=endpoint(c.dispatcherReportEndpoint);if(url!==state.endpoint){generation++;state.endpoint=url;state.receipts=[];state.lastError='';blocked=false;persist();}return url;}
    function enqueue(id,action){try{id=String(id);state.receipts=state.receipts.filter(r=>r.id!==id);if(!configured()||!deps.settings().dispatcherReportEnabled){persist();return false;}align();const old=state.operations.find(o=>o.id===id),version=Math.max(now(),(old?.version||0)+1);state.operations=state.operations.filter(o=>o.id!==id);if(state.operations.length>=10000){state.lastError='REPORT_CAPACITY';persist();return false;}state.operations.push({id,action,version,attempts:0,next:0,error:''});persist();if(!blocked)schedule();return true;}catch(e){state.lastError=e?.message==='INVALID_ENDPOINT'?'INVALID_ENDPOINT':'REPORT_QUEUE_ERROR';persist();return false;}}
    function flush(){if(flight)return flight;flight=flushBatch().finally(()=>{flight=null;});return flight;}
    async function flushBatch(){
      if(running||blocked||!configured()||deps.online?.()===false)return;
      running=true;let failed=false,sent=[],g=generation;persist();
      try{
        const url=align(),batch=state.operations.filter(o=>o.attempts<3&&!o.error&&o.next<=now()).slice(0,50);g=generation;
        if(!batch.length)return;
        const dtos=[],deletes=[];
        for(const o of batch){
          if(o.action==='delete'){deletes.push({ticket_id:o.id,source_version:o.version});sent.push(o);continue;}
          const ticket=deps.ticket(o.id);if(!ticket){state.operations=state.operations.filter(x=>x!==o);continue;}
          try{
            const dto=await deps.dto(ticket,o.version);
            if(Object.values(dto).some(v=>typeof v==='string'&&/^[\s]*[=+@-]/.test(v)))throw new Error('FORMULA_REJECTED');
            // GAS rejects oversized requests atomically. Bound the actual
            // serialized envelope rather than assuming 50 DTOs always fit.
            if(JSON.stringify({tickets:[...dtos,dto],deletes}).length>400000)break;
            dtos.push(dto);sent.push(o);
          }catch(e){o.error=PERMANENT.test(e.code||e.message)?e.code||e.message:'INVALID_DTO';state.lastError=o.error;persist();}
        }
        if(!sent.length)return;
        // Rendering the complete archive after every page causes progressively
        // more GAS work. Only the final eligible page rebuilds the report.
        const rebuild=!state.operations.some(o=>!sent.includes(o)&&o.attempts<3&&!o.error);
        const response=await deps.send(url,{action:'report_sync_all',tickets:dtos,deletes,request_id:deps.requestId(),rebuild});
        if(g!==generation||url!==deps.settings().dispatcherReportEndpoint)return;
        if(!response?.ok)throw new Error(response?.code||'REPORT_NETWORK_ERROR');
        if(['inserted','updated','unchanged','deleted','rejected','errors'].some(k=>k in response)){
          if(response.rejected||response.errors||!['inserted','updated','unchanged','deleted'].every(k=>Number.isSafeInteger(response[k])&&response[k]>=0)||response.inserted+response.updated+response.unchanged+response.deleted!==sent.length)throw new Error('REPORT_PARTIAL_ACK');
        }
        const versions=new Map(sent.map(o=>[o.id,o.version]));state.operations=state.operations.filter(o=>versions.get(o.id)!==o.version);
        for(const o of sent){state.receipts=state.receipts.filter(r=>r.id!==o.id);if(o.action==='upsert'&&!state.operations.some(n=>n.id===o.id))state.receipts.push({id:o.id,version:o.version});}
        state.receipts=state.receipts.slice(-10000);state.lastError='';state.lastSuccess=new Date(now()).toISOString();persist();
      }catch(e){
        if(g!==generation)return;
        failed=true;const code=String(e?.message||'REPORT_NETWORK_ERROR');state.lastError=/^[A-Z_]+$/.test(code)?code:'REPORT_NETWORK_ERROR';
        // No retry of privacy/schema failures. Bounded retries for transport,
        // consent, throttling and service failures, including across reload.
        if(CONNECTION.test(state.lastError))blocked=true;
        else for(const o of sent.filter(o=>state.operations.includes(o))){o.attempts++;if(PERMANENT.test(state.lastError))o.error=state.lastError;o.next=now()+[5000,30000,120000][o.attempts-1];}
        persist();
      }finally{
        running=false;persist();const eligible=state.operations.filter(o=>o.attempts<3&&!o.error);if(!blocked&&configured()&&eligible.length)schedule(Math.max(failed?5000:0,Math.min(...eligible.map(o=>o.next))-now()));
      }
    }
    function fullSync(){
      if(!configured())throw new Error('REPORT_NOT_CONFIGURED');align();
      const previous=new Map(state.operations.map(o=>[o.id,o])),live=deps.tickets();
      if(live.length>10000)throw new Error('REPORT_CAPACITY');
      const ids=new Set(live.map(t=>String(t.id))),version=now();
      const operations=state.operations.filter(o=>!ids.has(o.id)&&o.action==='delete');
      for(const t of live){const id=String(t.id);operations.push({id,action:'upsert',version:Math.max(version,(previous.get(id)?.version||0)+1),attempts:0,next:0,error:''});}
      if(operations.length>10000)throw new Error('REPORT_CAPACITY');state.operations=operations;state.receipts=state.receipts.filter(r=>!ids.has(r.id));persist();if(!blocked)schedule();return status();
    }
    function retry(){for(const o of state.operations){o.attempts=0;o.next=0;o.error='';}state.lastError='';blocked=false;persist();schedule();}
    function connectionReady(){blocked=false;if(CONNECTION.test(state.lastError))state.lastError='';persist();schedule();}
    function delivery(id){id=String(id);if(!configured())return{state:'not_configured',code:'REPORT_NOT_CONFIGURED'};if(state.endpoint&&state.endpoint!==deps.settings().dispatcherReportEndpoint)return{state:'not_configured',code:'GOOGLE_CONNECTION_REQUIRED'};const o=state.operations.find(o=>o.id===id);if(o)return{state:o.error||o.attempts>=3?'error':'pending',code:o.error||state.lastError};if(state.receipts.some(r=>r.id===id))return{state:'sent',code:''};return{state:deps.settings().dispatcherReportEnabled?'pending':'disabled',code:''};}
    async function syncAll(){
      fullSync();connectionReady();
      while(status().pending&&!blocked){await flush();if(state.lastError)break;}
      const s=status();if(s.pending||s.failed||s.lastError)throw new Error(s.lastError||'REPORT_SYNC_INCOMPLETE');
      return s;
    }
    async function archiveDiagnostics(){
      const live=deps.tickets(),dates=[],errors={};let projected=0;
      for(const t of live){try{const dto=await deps.dto(t,now());projected++;if(dto.work_date)dates.push(dto.work_date);}catch(e){const code=/^[A-Z_]+$/.test(e.code||e.message)?e.code||e.message:'INVALID_DTO';errors[code]=(errors[code]||0)+1;}}
      dates.sort();const acknowledged=live.filter(t=>delivery(t.id).state==='sent').length;
      return {source_tickets:live.length,projected_tickets:projected,acknowledged_tickets:acknowledged,missing_receipts:live.length-acknowledged,earliest_source:dates[0]||'',latest_source:dates.at(-1)||'',projection_errors:errors,...status()};
    }
    return Object.freeze({enqueueUpsert:t=>enqueue(t.id,'upsert'),enqueueDelete:id=>enqueue(id,'delete'),flush,fullSync,syncAll,archiveDiagnostics,retry,status,delivery,connectionReady});
  }
  function createBridge(){
    let popup=null,peer=null,peerOrigin='',channel='',url='',ready=null,connected=false,verified=false,checking=null,resolveReady=null,rejectReady=null,readyTimer=null,readyHandler=null;
    const pending=new Map();
    function close(){try{popup?.close();}catch(_){}popup=null;peer=null;peerOrigin='';channel='';url='';ready=null;connected=false;verified=false;checking=null;clearTimeout(readyTimer);rejectReady?.(new Error('REPORT_CONNECTION_RESET'));resolveReady=null;rejectReady=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('REPORT_CONNECTION_RESET'));}pending.clear();}
    window.addEventListener('message',e=>{
      // Android standalone may report popup.closed on app/browser handoff.
      // Liveness comes from the nonce/source/origin-pinned peer, not .closed.
      const d=e.data;if(!d||!channel||d.channel!==channel||!popup)return;
      // Only the HtmlService child of THIS authenticated Google window may
      // complete the channel. No arbitrary Google window can become the peer.
      if(d.type==='MT_REPORT_BOOT'&&!peer){let host;try{const o=new URL(e.origin);host=o.protocol==='https:'&&(o.hostname==='script.google.com'||o.hostname.endsWith('.googleusercontent.com'));if(e.source?.top!==popup)return;}catch(_){return;}if(!host)return;peer=e.source;peerOrigin=e.origin;peer.postMessage({type:'MT_REPORT_HELLO',channel},peerOrigin);return;}
      if(e.source!==peer||e.origin!==peerOrigin)return;
      if(d.type==='MT_REPORT_BOOT'){peer.postMessage({type:'MT_REPORT_HELLO',channel},peerOrigin);return;}
      if(d.type==='MT_REPORT_READY'){clearTimeout(readyTimer);connected=true;peer.postMessage({type:'MT_REPORT_ACK',channel},peerOrigin);resolveReady?.();resolveReady=null;rejectReady=null;ready=null;return;}
      if(d.type==='MT_REPORT_RESPONSE'){const p=pending.get(d.id);if(p){clearTimeout(p.timer);pending.delete(d.id);peer.postMessage({type:'MT_REPORT_RECEIPT',channel,id:d.id},peerOrigin);p.resolve(d.result);}}
    });
    async function connect(value,interactive=false){
      const target=endpoint(value);if(url===target&&popup){if(connected&&peer)return;if(ready)return ready;}
      // A background local save must never open a window or demand consent.
      if(!interactive)throw new Error('GOOGLE_CONNECTION_REQUIRED');
      close();url=target;channel=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
      ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;readyTimer=setTimeout(()=>{ready=null;connected=false;resolveReady=null;rejectReady=null;reject(new Error('GOOGLE_BRIDGE_TIMEOUT'));},20000);});
      const u=new URL(target);u.searchParams.set('origin',location.origin);u.searchParams.set('channel',channel);
      // Keep opener ONLY for this validated Google endpoint's nonce-pinned
      // postMessage bridge. No DTO or credential is placed in the URL.
      const wait=ready;try{popup=window.MTDispatcherReportOpen(u.href);if(!popup)throw new Error('GOOGLE_POPUP_BLOCKED');}catch(e){clearTimeout(readyTimer);rejectReady(new Error(/^[A-Z_]+$/.test(e?.message)?e.message:'GOOGLE_POPUP_BLOCKED'));ready=null;resolveReady=null;rejectReady=null;}return wait;
    }
    function rpc(request){const id=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);connected=false;verified=false;reject(new Error('GOOGLE_CONNECTION_REQUIRED'));},request.action==='report_status'?20000:90000);pending.set(id,{resolve,reject,timer});try{peer.postMessage({type:'MT_REPORT_REQUEST',channel,id,request},peerOrigin);}catch(_){clearTimeout(timer);pending.delete(id);connected=false;verified=false;reject(new Error('GOOGLE_CONNECTION_REQUIRED'));}});}
    function verify(){
      if(verified)return Promise.resolve();if(checking)return checking;
      const nonce=channel;
      checking=rpc({action:'report_status',request_id:crypto.randomUUID()}).then(result=>{
        if(nonce!==channel)throw new Error('REPORT_CONNECTION_RESET');
        if(!result?.ok)throw new Error(result?.code||'REPORT_NETWORK_ERROR');
        verified=true;peer.postMessage({type:'MT_REPORT_VERIFIED',channel},peerOrigin);readyHandler?.();
      }).catch(error=>{if(nonce===channel){verified=false;if(peer)peer.postMessage({type:'MT_REPORT_FAILED',channel,code:/^[A-Z_]+$/.test(error?.message)?error.message:'REPORT_NETWORK_ERROR'},peerOrigin);}throw error;}).finally(()=>{if(nonce===channel)checking=null;});return checking;
    }
    async function send(value,request,interactive=false){await connect(value,interactive);await verify();return rpc(request);}
    async function resume(){verified=false;if(!peer||!channel)return false;peer.postMessage({type:'MT_REPORT_HELLO',channel},peerOrigin);await verify();return true;}
    return {send,close,authorize:async value=>{await connect(value,true);await verify();},resume,onReady:fn=>{readyHandler=fn;}};
  }
  root.MTDispatcherReportClient=Object.freeze({createOutbox,endpoint});
  if(typeof document==='undefined')return;
  const bridge=createBridge(),cfg=()=>typeof settings==='object'?settings:{};
  const outbox=createOutbox({storage:localStorage,settings:cfg,tickets:()=>typeof tickets==='undefined'?[]:tickets,ticket:id=>typeof tickets==='undefined'?null:tickets.find(t=>String(t.id)===id),
    dto:async(t,v)=>(await import('./dispatcher-report-projection.mjs')).buildDTO(t,root.MTDispatcherReportCore,v),send:bridge.send,requestId:()=>crypto.randomUUID(),online:()=>navigator.onLine,
    // Browser timers require Window as receiver, not the dependency object.
    setTimeout:(fn,ms)=>window.setTimeout(fn,ms),clearTimeout:id=>window.clearTimeout(id),changed:()=>refreshUI()});
  bridge.onReady(()=>outbox.connectionReady());
  const deliveryLabels={sent:'✅',pending:'⏳',error:'❌',disabled:'',not_configured:''};
  function badge(id){return 'Таблиця Д '+deliveryLabels[outbox.delivery(id).state];}
  function refreshUI(){renderSettings();document.querySelectorAll('[data-dispatcher-ticket-status]').forEach(el=>{const d=outbox.delivery(el.dataset.dispatcherTicketStatus);el.textContent=badge(el.dataset.dispatcherTicketStatus);el.dataset.deliveryState=d.state;el.title=d.code||'';});if(typeof renderSyncQueueBanner==='function')renderSyncQueueBanner();}
  function renderSettings(){const c=cfg(),u=document.getElementById('dispatcherReportEndpoint'),enable=document.getElementById('dispatcherReportEnabled'),s=document.getElementById('dispatcherReportStatus');if(u&&document.activeElement!==u)u.value=c.dispatcherReportEndpoint||'';if(enable)enable.checked=!!c.dispatcherReportEnabled;const x=outbox.status();if(s)s.textContent=`У черзі: ${x.pending}. Помилки заявок: ${x.failed}.${x.running?' Надсилання…':''}${x.lastSuccess?' Остання синхронізація: '+x.lastSuccess:''}${x.lastError?' Канал: '+x.lastError:''}`;}
  function message(text){const e=document.getElementById('dispatcherReportResult');if(e)e.textContent=text;}
  const activeActions=new Set();
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-dispatcher-action]'),action=button?.dataset.dispatcherAction;if(!action||activeActions.has(action))return;
    activeActions.add(action);button.disabled=true;button.setAttribute('aria-busy','true');
    try{
      if(action==='diagnostics'){
        const local=await outbox.archiveDiagnostics();
        // Only counts/codes/lifecycle metadata. No IDs, ticket text, endpoint
        // credentials, private fields or storage payloads are displayed.
        const diagnostics={app_version:typeof APP_VERSION==='undefined'?'UNKNOWN':APP_VERSION,standalone:window.matchMedia('(display-mode: standalone)').matches,visibility:document.visibilityState,auto_send:!!cfg().dispatcherReportEnabled,service_worker_controlled:!!navigator.serviceWorker?.controller,local};
        try{const remote=await bridge.send(cfg().dispatcherReportEndpoint,{action:'report_status',request_id:crypto.randomUUID()});if(!remote?.ok)throw new Error(remote?.code||'REPORT_NETWORK_ERROR');diagnostics.report={written_tickets:remote.active_count,earliest_report:remote.earliest_date||'UNKNOWN',latest_report:remote.latest_date||'UNKNOWN'};}catch(e){diagnostics.connection=/^[A-Z_]+$/.test(e?.message)?e.message:'REPORT_NETWORK_ERROR';}
        message(JSON.stringify(diagnostics));return;
      }
      if(action==='save'){const value=document.getElementById('dispatcherReportEndpoint').value.trim();const enabled=document.getElementById('dispatcherReportEnabled').checked;const validated=value?endpoint(value):'';if(enabled&&!validated)throw new Error('REPORT_NOT_CONFIGURED');const changed=cfg().dispatcherReportEndpoint!==validated;cfg().dispatcherReportEndpoint=validated;cfg().dispatcherReportEnabled=enabled;saveSettings();if(changed)bridge.close();renderSettings();message('Окремі налаштування збережено. Стару синхронізацію не змінено.');return;}
      if(action==='authorize'){message('Google авторизацію виконуємо. Перевіряємо канал звіту...');await bridge.authorize(cfg().dispatcherReportEndpoint);message('Таблиця Д підключена');void outbox.flush();return;}
      const response=await bridge.send(cfg().dispatcherReportEndpoint,{action:action==='rebuild'?'report_rebuild':'report_status',request_id:crypto.randomUUID()},true);
      if(!response?.ok)throw new Error(response?.code||'REPORT_NETWORK_ERROR');
      // Preflight the authenticated connection before adding every ticket.
      if(action==='sync'){
        message('Переносимо весь локальний архів. Не закривайте застосунок.');await outbox.syncAll();
        const status=await bridge.send(cfg().dispatcherReportEndpoint,{action:'report_status',request_id:crypto.randomUUID()});
        if(!status?.ok)throw new Error(status?.code||'REPORT_NETWORK_ERROR');
        const source=typeof tickets==='undefined'?[]:tickets,ids=source.map(t=>String(t.id)).sort();
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ids)))),n=>n.toString(16).padStart(2,'0')).join('');
        if(status.active_count!==source.length||status.id_set_hash!==hash)throw new Error('REPORT_ARCHIVE_MISMATCH');
        message(`Весь архів підтверджено: ${source.length} / ${status.active_count}. Дати: ${status.earliest_date||'—'} — ${status.latest_date||'—'}.`);return;
      }
      if(action==='retry'){outbox.retry();await outbox.flush();message('Повтор черги завершено. Перевірте стан каналу.');return;}
      outbox.connectionReady();message(action==='rebuild'?'Видимий звіт перебудовано.':`Підключено. Активних нарядів: ${Number(response.active_count)||0}; видалених: ${Number(response.deleted_count)||0}.`);
    }catch(e){message('Звіт не відправлено. '+(/^[A-Z_]+$/.test(e?.message)?e.message:'REPORT_NETWORK_ERROR')+'. Локальні заявки та стара синхронізація не змінені.');}
    finally{activeActions.delete(action);button.disabled=false;button.removeAttribute('aria-busy');refreshUI();}
  });
  async function resume(){refreshUI();try{if(await bridge.resume()){message('Таблиця Д підключена');await outbox.flush();}}catch(e){message('Канал звіту не підтверджено: '+(/^[A-Z_]+$/.test(e?.message)?e.message:'REPORT_NETWORK_ERROR'));}}
  window.addEventListener('online',resume);window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resume();});document.addEventListener('DOMContentLoaded',resume);
  root.MTDispatcherReport=Object.freeze({...outbox,renderSettings,badge,enabled:()=>!!cfg().dispatcherReportEnabled});
})(typeof globalThis==='object'?globalThis:this);
