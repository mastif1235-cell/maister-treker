/* Parallel dispatcher outbox. Persist ONLY operation metadata, never tickets,
   private text or credentials. A report failure never rejects a local save. */
(function(root){
  'use strict';
  const KEY='mtDispatcherReportOutboxV1',PERMANENT=/^(?:INVALID_|UNKNOWN_|PRIVACY_|HASH_|FORMULA_|STALE_|REPORT_SCHEMA|LEGACY_|DUPLICATE_)/;
  const CONNECTION=/^(?:GOOGLE_\w+|REPORT_CONNECTION_RESET|REPORT_NOT_CONFIGURED|INVALID_ENDPOINT)$/;
  function endpoint(value){let url;try{url=new URL(String(value||''));}catch(_){throw new Error('INVALID_ENDPOINT');}if(url.protocol!=='https:'||url.hostname!=='script.google.com'||url.username||url.password||url.port||!/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)||url.search||url.hash)throw new Error('INVALID_ENDPOINT');return url.href;}
  function createOutbox(deps){
    let state={endpoint:'',operations:[],receipts:[],diagnostics:[],sync:null,lastError:'',lastSuccess:'',inflight:null},running=false,timer=null,generation=0,blocked=false,flight=null;
    try{const saved=JSON.parse(deps.storage.getItem(KEY)||'null');if(saved&&Array.isArray(saved.operations)&&saved.operations.length<=10000){state={...state,...saved};state.operations=saved.operations.filter(o=>o&&typeof o.id==='string'&&['upsert','delete'].includes(o.action)&&Number.isSafeInteger(o.version)&&Number.isInteger(o.attempts)&&o.attempts>=0&&o.attempts<=3).map(o=>({id:o.id,action:o.action,version:o.version,attempts:o.attempts,next:Number(o.next)||0,error:String(o.error||'')}));}}catch(_){state.lastError='LOCAL_QUEUE_UNAVAILABLE';}
    const now=()=>deps.now?.()??Date.now();
    // Recover v91.88's per-ticket failures caused by ONE shared connection
    // failure. Keep all operation IDs/versions, never tickets or private DTOs.
    for(const o of state.operations)if(CONNECTION.test(o.error)||CONNECTION.test(state.lastError)){o.attempts=0;o.next=0;if(CONNECTION.test(o.error))o.error='';}
    state.receipts=(Array.isArray(state.receipts)?state.receipts:[]).filter(r=>r&&typeof r.id==='string'&&Number.isSafeInteger(r.version)).slice(-10000).map(r=>({id:r.id,version:r.version}));
    // In-flight batch metadata only (ids/versions/request_id/rebuild) — never
    // DTOs, tickets or private text. It survives reloads so a lost ACK can be
    // reconciled or retried idempotently instead of blindly duplicated.
    state.inflight=state.inflight&&typeof state.inflight==='object'&&typeof state.inflight.request_id==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(state.inflight.request_id)&&Array.isArray(state.inflight.ops)
      ?{action:'report_sync_all',request_id:state.inflight.request_id,rebuild:state.inflight.rebuild===true,ts:Number(state.inflight.ts)||0,ops:state.inflight.ops.filter(o=>o&&typeof o.id==='string'&&['upsert','delete'].includes(o.action)&&Number.isSafeInteger(o.version)).map(o=>({id:o.id,action:o.action,version:o.version}))}
      :null;
    if(state.inflight&&!state.inflight.ops.length)state.inflight=null;
    state.diagnostics=(Array.isArray(state.diagnostics)?state.diagnostics:[]).filter(d=>d&&typeof d.ticket_id==='string'&&['upsert','delete'].includes(d.operation_type)&&Number.isSafeInteger(d.timestamp)&&d.reason==='TICKET_LOOKUP_MISSING').slice(-10000).map(d=>({ticket_id:d.ticket_id,operation_type:d.operation_type,timestamp:d.timestamp,reason:d.reason}));
    const savedSync=state.sync;
    state.sync=savedSync&&Array.isArray(savedSync.expected)&&savedSync.expected.length<=10000?{
      expected:savedSync.expected.filter(o=>o&&typeof o.id==='string'&&['upsert','delete'].includes(o.action)&&Number.isSafeInteger(o.version)).map(o=>({id:o.id,action:o.action,version:o.version,acknowledged:o.acknowledged===true})),
      batch_count:Number.isSafeInteger(savedSync.batch_count)&&savedSync.batch_count>=0?savedSync.batch_count:0,
      final_validation:['PASS','FAIL'].includes(savedSync.final_validation)?savedSync.final_validation:'PENDING'
    }:null;
    blocked=CONNECTION.test(state.lastError);
    function persist(){try{deps.storage.setItem(KEY,JSON.stringify({endpoint:state.endpoint,operations:state.operations,receipts:state.receipts,diagnostics:state.diagnostics,sync:state.sync,lastError:state.lastError,lastSuccess:state.lastSuccess,inflight:state.inflight}));}catch(_){state.lastError='LOCAL_QUEUE_UNAVAILABLE';}deps.changed?.(status());}
    function syncProgress(){if(!state.sync)return null;const expected=state.sync.expected,unresolved=expected.filter(o=>!o.acknowledged);return {expected_count:expected.length,received_ack_count:expected.length-unresolved.length,failed_count:unresolved.filter(o=>state.operations.some(n=>n.id===o.id&&(n.error||n.attempts>=3))).length,unresolved_count:unresolved.length,batch_count:state.sync.batch_count,final_validation:state.sync.final_validation};}
    function status(){return {pending:state.operations.filter(o=>o.attempts<3&&!o.error).length,failed:state.operations.filter(o=>o.attempts>=3||o.error).length,unresolved:state.operations.length,sync:syncProgress(),lastError:state.lastError,lastSuccess:state.lastSuccess,running,connectionRequired:blocked};}
    function invalidateExpected(id,action,version){if(!state.sync)return;const o=state.sync.expected.find(o=>o.id===id);if(o)Object.assign(o,{action,version,acknowledged:false});state.sync.final_validation='PENDING';}
    function missingLookup(o){o.error='TICKET_LOOKUP_MISSING';state.lastError=o.error;state.diagnostics=state.diagnostics.filter(d=>d.ticket_id!==o.id);state.diagnostics.push({ticket_id:o.id,operation_type:o.action,timestamp:now(),reason:o.error});state.diagnostics=state.diagnostics.slice(-10000);telemetry('lookup_miss',{code:'TICKET_LOOKUP_MISSING',store_ready:storeReady(),pending:status().pending,failed:status().failed,unresolved:status().unresolved});persist();}
    // ACK completion is shared by the live send path and the late/reconciled
    // path (Android handoff). Only the EXACT acknowledged versions leave the
    // queue: an old ACK can never confirm a newer edit; nothing is ever
    // removed without a server-side confirmation.
    function completeSent(sent,response){
      if(state.sync)for(const o of sent){const expected=state.sync.expected.find(n=>n.id===o.id&&n.action===o.action&&n.version===o.version);if(expected)expected.acknowledged=true;}
      const versions=new Map(sent.map(o=>[o.id,o.version]));state.operations=state.operations.filter(o=>versions.get(o.id)!==o.version);
      for(const o of sent){state.receipts=state.receipts.filter(r=>r.id!==o.id);if(o.action==='upsert'&&!state.operations.some(n=>n.id===o.id))state.receipts.push({id:o.id,version:o.version});}
      state.receipts=state.receipts.slice(-10000);state.lastError='';state.lastSuccess=new Date(now()).toISOString();
      state.inflight=null;persist();
    }
    // Lost-ACK reconciliation (v91.94): a late/replayed response whose
    // request_id matches the persisted in-flight batch confirms those exact
    // operation versions as sent WITHOUT resending the mutation. Any other
    // answer (mismatched id, superseded versions, missing counters) is
    // ignored — the operations stay pending until a real confirmation.
    function reconcile(request,result){
      try{
        if(!request||!result||!result.ok||!state.inflight||request.request_id!==state.inflight.request_id)return false;
        const want=new Set(state.inflight.ops.map(o=>o.id+'#'+o.action+'#'+o.version));
        const sent=state.operations.filter(o=>want.has(o.id+'#'+o.action+'#'+o.version));
        if(!sent.length)return false;
        if(['inserted','updated','unchanged','deleted'].some(k=>k in result)){
          if(result.rejected||result.errors||!['inserted','updated','unchanged','deleted'].every(k=>Number.isSafeInteger(result[k])&&result[k]>=0)||result.inserted+result.updated+result.unchanged+result.deleted!==sent.length)return false;
        }
        const size=sent.length;
        completeSent(sent,result);
        telemetry('ack_received',{ack_count:size,batch_size:size});
        telemetry('send_result',{code:'RECONCILED',batch_size:size});
        return true;
      }catch(_){return false;}
    }
    function schedule(ms=0){if(timer!==null)deps.clearTimeout(timer);timer=deps.setTimeout(()=>{timer=null;void flush();},ms);}
    // Checkbox controls AUTOMATIC enqueue, not explicit manual sync/retry.
    // Since v91.94 the operation itself is ALWAYS persisted after a successful
    // local save: connection state, auto-send flag and endpoint health gate
    // only SENDING. A ticket ID is never lost to a silent `return false`.
    function configured(){return !!deps.settings().dispatcherReportEndpoint;}
    function align(){const c=deps.settings(),url=endpoint(c.dispatcherReportEndpoint);if(url!==state.endpoint){generation++;state.endpoint=url;state.receipts=[];state.sync=null;state.lastError='';state.inflight=null;blocked=false;persist();}return url;}
    function telemetry(event,fields){try{const t=typeof globalThis==='object'&&globalThis&&globalThis.MTDispatcherTelemetry;if(t&&typeof t.record==='function')t.record(event,fields);}catch(_){/* telemetry must never break the outbox */}}
    function storeReady(){try{const d=deps.storeReady;return typeof d==='function'?!!d():true;}catch(_){return true;}}
    function runtimeBlocked(){try{const g=typeof globalThis==='object'&&globalThis&&globalThis.MTDispatcherRuntimeGuard;return !!(g&&typeof g.blocked==='function'&&g.blocked());}catch(_){return false;}}
    function enqueue(id,action){try{
      id=String(id);state.receipts=state.receipts.filter(r=>r.id!==id);
      const settings=deps.settings();
      let configError='';
      if(!settings.dispatcherReportEndpoint)configError='REPORT_NOT_CONFIGURED';
      else{try{align();}catch(e){configError=e?.message==='INVALID_ENDPOINT'?'INVALID_ENDPOINT':'REPORT_QUEUE_ERROR';}}
      const old=state.operations.find(o=>o.id===id),version=Math.max(now(),(old?.version||0)+1);
      state.operations=state.operations.filter(o=>o.id!==id);
      if(state.operations.length>=10000){state.lastError='REPORT_CAPACITY';persist();telemetry('enqueue_result',{code:'REPORT_CAPACITY',pending:status().pending,failed:status().failed,unresolved:status().unresolved,store_ready:storeReady()});return false;}
      state.operations.push({id,action,version,attempts:0,next:0,error:configError});
      invalidateExpected(id,action,version);
      state.lastError=configError;
      persist();
      telemetry('operation_persisted',{code:configError||'OK',pending:status().pending,failed:status().failed,unresolved:status().unresolved,store_ready:storeReady()});
      telemetry('enqueue_result',{code:configError||'QUEUED',pending:status().pending,failed:status().failed,unresolved:status().unresolved,store_ready:storeReady()});
      if(!blocked&&!configError&&deps.settings().dispatcherReportEnabled)schedule();
      return true;
    }catch(e){state.lastError=e?.message==='INVALID_ENDPOINT'?'INVALID_ENDPOINT':'REPORT_QUEUE_ERROR';persist();telemetry('enqueue_result',{code:state.lastError,pending:status().pending,failed:status().failed,unresolved:status().unresolved,store_ready:storeReady()});return false;}}
    // Endpoint was fixed in Settings: clear config-blocked operations so the
    // preserved queue becomes sendable without losing a single ticket ID.
    function reconfigure(){for(const o of state.operations){if(o.error==='REPORT_NOT_CONFIGURED'||o.error==='INVALID_ENDPOINT'){o.error='';o.attempts=0;o.next=0;}}blocked=false;if(CONNECTION.test(state.lastError))state.lastError='';persist();if(deps.settings().dispatcherReportEnabled&&!blocked)schedule();return status();}
    function flush(){if(flight)return flight;flight=flushBatch().finally(()=>{flight=null;});return flight;}
    async function flushBatch(){
      if(running||blocked||!configured()||deps.online?.()===false)return;
      if(runtimeBlocked()){telemetry('flush_attempt',{code:'RUNTIME_GUARD',store_ready:storeReady(),pending:status().pending,failed:status().failed,unresolved:status().unresolved});return;}
      if(!storeReady()){
        // Before tickets load from IndexedDB an "empty" ticket list must never
        // drop operations or mark them TICKET_LOOKUP_MISSING (v91.88 wipe race).
        telemetry('store_not_ready',{store_ready:false,pending:status().pending,failed:status().failed,unresolved:status().unresolved});
        telemetry('flush_attempt',{code:'STORE_NOT_READY',store_ready:false,pending:status().pending,failed:status().failed,unresolved:status().unresolved});
        return;
      }
      telemetry('flush_attempt',{store_ready:true,pending:status().pending,failed:status().failed,unresolved:status().unresolved});
      running=true;let failed=false,sent=[],g=generation;persist();
      try{
        const url=align(),batch=state.operations.filter(o=>o.attempts<3&&!o.error&&o.next<=now()).slice(0,50);g=generation;
        if(!batch.length)return;
        const dtos=[],deletes=[];
        for(const o of batch){
          if(o.action==='delete'){deletes.push({ticket_id:o.id,source_version:o.version});sent.push(o);continue;}
          const ticket=deps.ticket(o.id);if(!ticket){missingLookup(o);continue;}
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
        // Idempotent retry (lost-ACK recovery): a batch whose mutation may
        // already be committed REUSES its original request_id and rebuild flag
        // so the server's REPORT_ACK_<request_id> receipt cache replays the
        // first result instead of executing the batch again (upsert is already
        // duplicate-safe; the replay avoids a second mutation entirely).
        const batchOps=sent.map(o=>({id:o.id,action:o.action,version:o.version}));
        const batchKey=JSON.stringify(batchOps.map(o=>o.id+'#'+o.action+'#'+o.version).sort());
        const reuse=!!(state.inflight&&state.inflight.action==='report_sync_all'&&JSON.stringify(state.inflight.ops.map(o=>o.id+'#'+o.action+'#'+o.version).sort())===batchKey);
        const rebuild=reuse?state.inflight.rebuild:!state.operations.some(o=>!sent.includes(o)&&o.attempts<3&&!o.error);
        if(state.sync){state.sync.batch_count++;state.sync.final_validation='PENDING';persist();}
        const request={action:'report_sync_all',tickets:dtos,deletes,request_id:reuse?state.inflight.request_id:deps.requestId(),rebuild};
        state.inflight={action:'report_sync_all',request_id:request.request_id,rebuild,ts:now(),ops:batchOps};
        persist();
        telemetry('send_attempt',{batch_size:dtos.length+deletes.length,store_ready:true});
        let response,retried=false;
        for(;;){
          try{response=await deps.send(url,request);}
          catch(sendError){
            // A replayed request_id whose bytes no longer match must never be
            // treated as a permanent failure: fall back to a fresh request_id.
            if(reuse&&!retried&&String(sendError?.message)==='INVALID_REQUEST_ID'){retried=true;request.request_id=deps.requestId();state.inflight={action:'report_sync_all',request_id:request.request_id,rebuild,ts:now(),ops:batchOps};persist();continue;}
            throw sendError;
          }
          if(reuse&&!retried&&!response?.ok&&response?.code==='INVALID_REQUEST_ID'){retried=true;request.request_id=deps.requestId();state.inflight={action:'report_sync_all',request_id:request.request_id,rebuild,ts:now(),ops:batchOps};persist();continue;}
          break;
        }
        if(g!==generation||url!==deps.settings().dispatcherReportEndpoint)return;
        if(!response?.ok)throw new Error(response?.code||'REPORT_NETWORK_ERROR');
        if(['inserted','updated','unchanged','deleted','rejected','errors'].some(k=>k in response)){
          if(response.rejected||response.errors||!['inserted','updated','unchanged','deleted'].every(k=>Number.isSafeInteger(response[k])&&response[k]>=0)||response.inserted+response.updated+response.unchanged+response.deleted!==sent.length)throw new Error('REPORT_PARTIAL_ACK');
        }
        // Full archive ACK accounting must never infer confirmation from an
        // empty/legacy ok:true response without mutation counters.
        if(state.sync&&!['inserted','updated','unchanged','deleted'].every(k=>Number.isSafeInteger(response[k])&&response[k]>=0))throw new Error('REPORT_PARTIAL_ACK');
        completeSent(sent,response);
        telemetry('ack_received',{ack_count:dtos.length+deletes.length,batch_size:dtos.length+deletes.length});
        telemetry('send_result',{code:'OK',batch_size:dtos.length+deletes.length});
      }catch(e){
        if(g!==generation)return;
        failed=true;const code=String(e?.message||'REPORT_NETWORK_ERROR');state.lastError=/^[A-Z_]+$/.test(code)?code:'REPORT_NETWORK_ERROR';
        telemetry('send_result',{code:CONNECTION.test(state.lastError)?'REPORT_CONNECTION_REQUIRED':state.lastError});
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
      // Preserve missing upserts from earlier attempts. Only an explicit
      // enqueueDelete can replace them with a tombstone; absence is not delete.
      for(const o of state.operations.filter(o=>!ids.has(o.id)&&o.action==='upsert'))operations.push(o);
      if(operations.length>10000)throw new Error('REPORT_CAPACITY');state.operations=operations;state.inflight=null;state.sync={expected:operations.map(o=>({id:o.id,action:o.action,version:o.version,acknowledged:false})),batch_count:0,final_validation:'PENDING'};state.receipts=state.receipts.filter(r=>!ids.has(r.id));persist();if(!blocked)schedule();return status();
    }
    function retry(){for(const o of state.operations){o.attempts=0;o.next=0;o.error='';}if(state.sync&&state.operations.length)state.sync.final_validation='PENDING';state.lastError='';blocked=false;persist();schedule();}
    function connectionReady(){blocked=false;if(CONNECTION.test(state.lastError))state.lastError='';persist();schedule();}
    function delivery(id){id=String(id);if(!configured())return{state:'not_configured',code:'REPORT_NOT_CONFIGURED'};if(state.endpoint&&state.endpoint!==deps.settings().dispatcherReportEndpoint)return{state:'not_configured',code:'GOOGLE_CONNECTION_REQUIRED'};const o=state.operations.find(o=>o.id===id);if(o)return{state:o.error||o.attempts>=3?'error':'pending',code:o.error||state.lastError};if(state.receipts.some(r=>r.id===id))return{state:'sent',code:''};return{state:deps.settings().dispatcherReportEnabled?'pending':'disabled',code:''};}
    async function syncAll(){
      // flushBatch may no-op while the store is not ready / runtime is mixed;
      // this loop must never spin forever on that, and a manual sync must fail
      // with an explicit code instead of wiping or hanging.
      if(runtimeBlocked())throw new Error('REPORT_RUNTIME_MIXED');
      if(!storeReady())throw new Error('REPORT_STORE_NOT_READY');
      fullSync();connectionReady();
      while(status().pending&&!blocked&&deps.online?.()!==false){await flush();if(state.lastError&&state.lastError!=='TICKET_LOOKUP_MISSING')break;}
      const s=status();if(s.unresolved||s.sync?.unresolved_count||s.lastError){if(state.sync)state.sync.final_validation='FAIL';persist();throw new Error(s.lastError||'REPORT_SYNC_INCOMPLETE');}
      return s;
    }
    function confirmArchive(remote,expectedHash,sourceCount){
      // GAS v7 report_status has no id_set_hash: that is a contract-version gap,
      // not an archive mismatch. Upgrade detection first (task Q40/v91.94).
      if(remote&&remote.id_set_hash===undefined)throw new Error('REPORT_GAS_UPGRADE_REQUIRED');
      const s=status();if(!state.sync||s.unresolved||s.lastError||s.sync.unresolved_count||s.sync.expected_count!==s.sync.received_ack_count||!remote?.ok||remote.active_count!==sourceCount||!/^[a-f0-9]{64}$/.test(expectedHash)||remote.id_set_hash!==expectedHash){if(state.sync)state.sync.final_validation='FAIL';persist();throw new Error('REPORT_ARCHIVE_MISMATCH');}
      state.sync.final_validation='PASS';persist();return status();
    }
    async function archiveDiagnostics(){
      const live=deps.tickets(),dates=[],errors={};let projected=0;
      for(const t of live){try{const dto=await deps.dto(t,now());projected++;if(dto.work_date)dates.push(dto.work_date);}catch(e){const code=/^[A-Z_]+$/.test(e.code||e.message)?e.code||e.message:'INVALID_DTO';errors[code]=(errors[code]||0)+1;}}
      dates.sort();const acknowledged=live.filter(t=>delivery(t.id).state==='sent').length;
      return {source_tickets:live.length,projected_tickets:projected,acknowledged_tickets:acknowledged,missing_receipts:live.length-acknowledged,earliest_source:dates[0]||'',latest_source:dates.at(-1)||'',projection_errors:errors,...status()};
    }
    return Object.freeze({enqueueUpsert:t=>enqueue(t.id,'upsert'),enqueueDelete:id=>enqueue(id,'delete'),flush,fullSync,syncAll,confirmArchive,archiveDiagnostics,retry,status,delivery,connectionReady,reconfigure,reconcile});
  }
  function createBridge(){
    let popup=null,peer=null,peerOrigin='',channel='',url='',ready=null,connected=false,verified=false,checking=null,resolveReady=null,rejectReady=null,readyTimer=null,readyHandler=null;
    let lastStatusAck='',lastReason='',resumeFlight=null;
    const pending=new Map();
    // Timed-out RPCs stay here (bounded, lazy cleanup — never extra timers):
    // the Google child keeps its own receipts and replays them on HELLO after
    // an Android handoff. A late/replayed MT_REPORT_RESPONSE is NOT dropped.
    const timedOut=new Map();
    let lateHandler=null;
    // Session-pinned bridge identity (technical sessionStorage only): lets the
    // app RE-ATTACH to the still-open named bridge window after an Android
    // process restart without opening anything or asking for consent again.
    const SESSION_KEY='mtDispatcherReportBridge';
    function saveSession(extra){try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({channel,url,peerOrigin,...(extra||{})}));}catch(_){}}
    function loadSession(){try{const s=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');return s&&typeof s==='object'&&s.channel&&s.url?s:null;}catch(_){return null;}}
    function rememberPeerOrigin(){saveSession({peerOrigin});}
    function resetState(){peer=null;peerOrigin='';channel='';url='';ready=null;connected=false;verified=false;checking=null;clearTimeout(readyTimer);rejectReady?.(new Error('REPORT_CONNECTION_RESET'));resolveReady=null;rejectReady=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('REPORT_CONNECTION_RESET'));}pending.clear();}
    function close(){try{popup?.close();}catch(_){}popup=null;resetState();try{sessionStorage.removeItem(SESSION_KEY);}catch(_){}}
    window.addEventListener('message',e=>{
      // Android standalone may report popup.closed on app/browser handoff.
      // Liveness comes from the nonce/source/origin-pinned peer, not .closed.
      const d=e.data;if(!d||!channel||d.channel!==channel||!popup)return;
      // Only the HtmlService child of THIS authenticated Google window may
      // complete the channel. No arbitrary Google window can become the peer.
      if(d.type==='MT_REPORT_BOOT'||d.type==='MT_REPORT_READY'){
        let host=false;try{const o=new URL(e.origin);host=o.protocol==='https:'&&(o.hostname==='script.google.com'||o.hostname.endsWith('.googleusercontent.com'));}catch(_){/* fail closed */}
        if(!host||e.source?.top!==popup)return;
        // First valid hello binds the peer exactly once; a reload may only
        // re-pin the (redirect-volatile) Google origin of the SAME window.
        if(!peer){peer=e.source;peerOrigin=e.origin;rememberPeerOrigin();}
        else if(e.source!==peer)return;
        else if(e.origin!==peerOrigin){peerOrigin=e.origin;rememberPeerOrigin();}
        if(d.type==='MT_REPORT_BOOT'){peer.postMessage({type:'MT_REPORT_HELLO',channel},peerOrigin);return;}
      }else if(e.source!==peer||e.origin!==peerOrigin)return;
      if(d.type==='MT_REPORT_READY'){clearTimeout(readyTimer);connected=true;peer.postMessage({type:'MT_REPORT_ACK',channel},peerOrigin);resolveReady?.();resolveReady=null;rejectReady=null;ready=null;return;}
      if(d.type==='MT_REPORT_RESPONSE'){const p=pending.get(d.id);if(p){clearTimeout(p.timer);pending.delete(d.id);peer.postMessage({type:'MT_REPORT_RECEIPT',channel,id:d.id},peerOrigin);p.resolve(d.result);return;}const late=timedOut.get(d.id);if(late){timedOut.delete(d.id);peer.postMessage({type:'MT_REPORT_RECEIPT',channel,id:d.id},peerOrigin);try{lateHandler?.(late.request,d.result);}catch(_){/* reconciliation must never break the channel */}}return;}
    });
    let reviveFlight=null,reviveProbeAt=0;
    // Re-attach to the session's still-open named bridge window: restore the
    // persisted channel nonce, say HELLO to the popup/frames and wait for the
    // pinned peer's READY. Never opens a window; never bypasses Google auth —
    // if the Google session itself expired, this honestly fails.
    function tryRevive(s,target){
      if(reviveFlight)return reviveFlight;
      reviveFlight=(async()=>{
        const w=window.MTDispatcherReportOpen&&typeof window.MTDispatcherReportOpen.reacquire==='function'?window.MTDispatcherReportOpen.reacquire():null;
        if(!w)return false;
        const keepChannel=s.channel,keepPeerOrigin=s.peerOrigin||'';
        resetState();
        url=target;channel=keepChannel;popup=w;peerOrigin=keepPeerOrigin;
        saveSession();
        const wait=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;readyTimer=setTimeout(()=>{ready=null;connected=false;resolveReady=null;rejectReady=null;reject(new Error('GOOGLE_BRIDGE_TIMEOUT'));},12000);});
        ready=wait;
        const targets=[popup];try{for(let i=0;i<popup.length&&i<4;i++)targets.push(popup.frames[i]);}catch(_){/* cross-origin frame list is best-effort */}
        for(const t of targets){try{t.postMessage({type:'MT_REPORT_HELLO',channel},peerOrigin||'*');}catch(_){}}
        try{await wait;return true;}catch(_){resetState();try{sessionStorage.removeItem(SESSION_KEY);}catch(_){}return false;}
      })().finally(()=>{reviveFlight=null;});
      return reviveFlight;
    }
    async function connect(value,interactive=false){
      const target=endpoint(value);if(url===target&&popup){if(connected&&peer)return;if(ready)return ready;}
      // A background local save must never open a window or demand consent.
      // It may, however, safely RE-ATTACH to the existing session's bridge.
      if(!interactive){
        const s=loadSession();
        if(s&&s.url===target&&Date.now()-reviveProbeAt>10000){
          reviveProbeAt=Date.now();
          if(await tryRevive(s,target))return ready;
        }
        throw new Error('GOOGLE_CONNECTION_REQUIRED');
      }
      resetState();url=target;channel=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
      ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;readyTimer=setTimeout(()=>{ready=null;connected=false;resolveReady=null;rejectReady=null;reject(new Error('GOOGLE_BRIDGE_TIMEOUT'));},20000);});
      const u=new URL(target);u.searchParams.set('origin',location.origin);u.searchParams.set('channel',channel);
      // Keep opener ONLY for this validated Google endpoint's nonce-pinned
      // postMessage bridge. No DTO or credential is placed in the URL.
      const wait=ready;try{popup=window.MTDispatcherReportOpen(u.href);if(!popup)throw new Error('GOOGLE_POPUP_BLOCKED');}catch(e){clearTimeout(readyTimer);rejectReady(new Error(/^[A-Z_]+$/.test(e?.message)?e.message:'GOOGLE_POPUP_BLOCKED'));ready=null;resolveReady=null;rejectReady=null;}saveSession();return wait;
    }
    function rpc(request){const id=crypto.randomUUID(),started=Date.now(),base=request.action==='report_status'?20000:90000;return new Promise((resolve,reject)=>{
      const expire=()=>{
        // Google is foreground while Android suspends the standalone caller.
        // Keep the same request/receipt alive for a bounded handoff interval.
        const p=pending.get(id),hiddenNow=typeof document!=='undefined'&&document.visibilityState==='hidden';
        if(hiddenNow&&Date.now()-started<300000){if(p){p.hiddenArmed=true;p.timer=setTimeout(expire,10000);}return;}
        // Frozen Android pages fire their timers late, on return to foreground.
        // A wait that outlived the base timeout (or was armed while hidden) gets
        // ONE bounded grace window instead of dying at the visible-return tick —
        // the response is usually replayed on HELLO right after resume.
        if(p&&!p.graceUsed&&(p.hiddenArmed||Date.now()-started>=base*1.5)&&Date.now()-started<300000){p.graceUsed=true;p.timer=setTimeout(expire,10000);return;}
        pending.delete(id);
        // Keep a bounded record of the request whose ACK may still arrive:
        // reconciliation marks its operations sent instead of a blind resend.
        timedOut.set(id,{request,ts:Date.now()});
        while(timedOut.size>20)timedOut.delete(timedOut.keys().next().value);
        connected=false;verified=false;lastReason='GOOGLE_CONNECTION_REQUIRED';reject(new Error(lastReason));
      };
      const timer=setTimeout(expire,base);pending.set(id,{resolve,reject,timer,hiddenArmed:false,graceUsed:false});
      try{peer.postMessage({type:'MT_REPORT_REQUEST',channel,id,request},peerOrigin);}catch(_){clearTimeout(timer);pending.delete(id);connected=false;verified=false;lastReason='GOOGLE_CONNECTION_REQUIRED';reject(new Error(lastReason));}
    });}
    function verify(){
      if(verified)return Promise.resolve();if(checking)return checking;
      const nonce=channel;
      checking=rpc({action:'report_status',request_id:crypto.randomUUID()}).then(result=>{
        if(nonce!==channel)throw new Error('REPORT_CONNECTION_RESET');
        if(!result?.ok)throw new Error(result?.code||'REPORT_NETWORK_ERROR');
        connected=true;verified=true;lastStatusAck=new Date().toISOString();lastReason='';peer.postMessage({type:'MT_REPORT_VERIFIED',channel},peerOrigin);readyHandler?.();
      }).catch(error=>{if(nonce===channel){verified=false;if(peer)peer.postMessage({type:'MT_REPORT_FAILED',channel,code:/^[A-Z_]+$/.test(error?.message)?error.message:'REPORT_NETWORK_ERROR'},peerOrigin);}throw error;}).finally(()=>{if(nonce===channel)checking=null;});return checking;
    }
    async function send(value,request,interactive=false){await connect(value,interactive);await verify();return rpc(request);}
    function resume(){
      if(resumeFlight)return resumeFlight;
      resumeFlight=(async()=>{
        if(peer&&channel){
          verified=false;
          peer.postMessage({type:'MT_REPORT_HELLO',channel},peerOrigin);
          await verify();return true;
        }
        // Safe auto-resume on focus/return: re-attach to the session's named
        // bridge window when it is still open. No window is opened here.
        const s=loadSession();
        if(s&&await tryRevive(s,s.url)){await verify();return true;}
        lastReason='GOOGLE_CONNECTION_REQUIRED';
        return false;
      })().finally(()=>{resumeFlight=null;});
      return resumeFlight;
    }
    return {send,close,authorize:async value=>{await connect(value,true);await verify();},resume,onReady:fn=>{readyHandler=fn;},onLateResult:fn=>{lateHandler=fn;},diagnostics:()=>({connected:connected&&verified,peer_present:!!peer,status_ack:lastStatusAck,reason:lastReason,pending_rpc:pending.size,timed_out_rpc:timedOut.size})};
  }
  root.MTDispatcherReportClient=Object.freeze({runtimeRevision:'runtime-139',createOutbox,endpoint});
  if(typeof document==='undefined')return;
  const bridge=createBridge(),cfg=()=>typeof settings==='object'?settings:{};
  const outbox=createOutbox({storage:localStorage,settings:cfg,tickets:()=>typeof tickets==='undefined'?[]:tickets,ticket:id=>typeof tickets==='undefined'?null:tickets.find(t=>String(t.id)===id),
    dto:async(t,v)=>(await import('./dispatcher-report-projection.mjs')).buildDTO(t,root.MTDispatcherReportCore,v),send:bridge.send,requestId:()=>crypto.randomUUID(),online:()=>navigator.onLine,
    // Browser timers require Window as receiver, not the dependency object.
    setTimeout:(fn,ms)=>window.setTimeout(fn,ms),clearTimeout:id=>window.clearTimeout(id),changed:x=>{record('queue_state',{pending:x.pending,failed:x.failed,unresolved:x.unresolved});refreshUI();},
    // Explicit store-ready gate: set by app.js after loadTicketsFromIdb(). An
    // empty ticket list before that point is not a missing-ticket signal.
    storeReady:()=>window.__mtTicketsStoreReady===true});
  const record=(event,fields)=>{try{root.MTDispatcherTelemetry?.record?.(event,fields);}catch(_){}};
  bridge.onReady(()=>{record('report_status_ack',{connected:true,verified:true});outbox.connectionReady();});
  // Replayed/late RPC responses (Bridge.html keeps receipts and replays them
  // on HELLO after an Android handoff) confirm the in-flight batch instead of
  // being dropped — the queue drains without a duplicate resend.
  bridge.onLateResult((request,result)=>{try{outbox.reconcile(request,result);}catch(_){/* reconciliation is best-effort */}});
  const deliveryLabels={sent:'✅',pending:'⏳',error:'❌',disabled:'',not_configured:''};
  function badge(id){return 'Таблиця Д '+deliveryLabels[outbox.delivery(id).state];}
  function refreshUI(){renderSettings();document.querySelectorAll('[data-dispatcher-ticket-status]').forEach(el=>{const d=outbox.delivery(el.dataset.dispatcherTicketStatus);el.hidden=!cfg().dispatcherReportEnabled||['disabled','not_configured'].includes(d.state);el.textContent=el.hidden?'':badge(el.dataset.dispatcherTicketStatus);el.dataset.deliveryState=d.state;el.title=d.code||'';});if(typeof renderSyncQueueBanner==='function')renderSyncQueueBanner();}
  function renderSettings(){const c=cfg(),u=document.getElementById('dispatcherReportEndpoint'),enable=document.getElementById('dispatcherReportEnabled'),s=document.getElementById('dispatcherReportStatus');if(u&&document.activeElement!==u)u.value=c.dispatcherReportEndpoint||'';if(enable)enable.checked=!!c.dispatcherReportEnabled;const x=outbox.status();if(s)s.textContent=`У черзі: ${x.unresolved}. Помилки заявок: ${x.failed}.${x.running?' Надсилання…':''}${x.lastSuccess?' Остання синхронізація: '+x.lastSuccess:''}${x.lastError?' Канал: '+x.lastError:''}`;}
  function message(text){const e=document.getElementById('dispatcherReportResult');if(e)e.textContent=text;}
  // Safe copy-diagnostics (v91.94): counts/codes/revisions ONLY. Never the
  // endpoint URL, ticket IDs or any private ticket field. Telemetry events are
  // pre-filtered to the safe field whitelist by dispatcher-telemetry.js.
  async function collectDiagnostics(){
    const c=cfg(),x=outbox.status(),b=bridge.diagnostics();
    const payload={
      app_version:typeof APP_VERSION==='undefined'?'UNKNOWN':APP_VERSION,
      app_runtime:root.MTAppRuntimeRevision||'UNKNOWN',
      loaded_modules:{compact:root.MTTicketCompactView?.runtimeRevision||'UNKNOWN',renderer:root.MTTicketRendererRevision||'UNKNOWN',report:root.MTDispatcherReportClient.runtimeRevision},
      runtime_guard:root.MTDispatcherRuntimeGuard?{state:root.MTDispatcherRuntimeGuard.state(),reason:root.MTDispatcherRuntimeGuard.reason()}:null,
      dispatcher_enabled:!!c.dispatcherReportEnabled,
      endpoint_configured:!!c.dispatcherReportEndpoint,
      connection:{connected:!!b.connected,verified:!!b.verified,reason:b.reason||''},
      queue:{pending:x.pending,failed:x.failed,unresolved:x.unresolved,last_error:x.lastError||''},
      telemetry:(root.MTDispatcherTelemetry?.dump?.()||[]).slice(-20)
    };
    if(navigator.serviceWorker?.controller){
      try{payload.runtime=await new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('RUNTIME_STATUS_TIMEOUT'));},5000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};navigator.serviceWorker.controller.postMessage({type:'MT_RUNTIME_STATUS'},[channel.port2]);});payload.sw_cache=payload.runtime.cacheName||'';}
      catch(e){payload.sw_cache='UNKNOWN';payload.runtime_reason=/^[A-Z_]+$/.test(e?.message)?e.message:'RUNTIME_STATUS_TIMEOUT';}
      try{
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);let proof;
        try{const response=await fetch('./runtime-proof.json',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('RUNTIME_PROOF_UNAVAILABLE');proof=await response.json();}finally{clearTimeout(timer);}
        payload.runtime_verified=proof.cacheName==='maister-treker-v69-runtime-139'&&payload.runtime?.cacheName===proof.cacheName&&Object.keys(proof.assets||{}).length===8&&Object.entries(proof.assets).every(([asset,hash])=>/^[a-f0-9]{64}$/.test(hash)&&payload.runtime.assets?.[asset]===hash)&&Object.values(payload.loaded_modules).every(revision=>revision==='runtime-139');
      }catch(e){payload.runtime_verified=false;payload.runtime_proof_reason=/^[A-Z_]+$/.test(e?.message)?e.message:'RUNTIME_PROOF_UNAVAILABLE';}
    }else{payload.runtime_verified=false;}
    return payload;
  }
  const activeActions=new Set();
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-dispatcher-action]'),action=button?.dataset.dispatcherAction;if(!action||activeActions.has(action))return;
    activeActions.add(action);button.disabled=true;button.setAttribute('aria-busy','true');
    try{
      if(action==='diagnostics'){
        const local=await outbox.archiveDiagnostics();
        // Only counts/codes/lifecycle metadata. No IDs, ticket text, endpoint
        // credentials, private fields or storage payloads are displayed.
        const diagnostics={app_version:typeof APP_VERSION==='undefined'?'UNKNOWN':APP_VERSION,standalone:window.matchMedia('(display-mode: standalone)').matches,visibility:document.visibilityState,auto_send:!!cfg().dispatcherReportEnabled,service_worker_controlled:!!navigator.serviceWorker?.controller,loaded_modules:{compact:root.MTTicketCompactView?.runtimeRevision||'UNKNOWN',renderer:root.MTTicketRendererRevision||'UNKNOWN',report:root.MTDispatcherReportClient.runtimeRevision},bridge:bridge.diagnostics(),local};
        if(navigator.serviceWorker?.controller){
          try{diagnostics.runtime=await new Promise((resolve,reject)=>{const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('RUNTIME_STATUS_TIMEOUT'));},5000);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data);};navigator.serviceWorker.controller.postMessage({type:'MT_RUNTIME_STATUS'},[channel.port2]);});}
          catch(e){diagnostics.runtime={reason:e.message};}
          try{
            const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);let proof;
            try{const response=await fetch('./runtime-proof.json',{cache:'no-store',signal:controller.signal});if(!response.ok)throw new Error('RUNTIME_PROOF_UNAVAILABLE');proof=await response.json();}finally{clearTimeout(timer);}
            diagnostics.runtime_verified=proof.cacheName==='maister-treker-v69-runtime-139'&&diagnostics.runtime?.cacheName===proof.cacheName&&Object.keys(proof.assets||{}).length===8&&Object.entries(proof.assets).every(([asset,hash])=>/^[a-f0-9]{64}$/.test(hash)&&diagnostics.runtime.assets?.[asset]===hash)&&Object.values(diagnostics.loaded_modules).every(revision=>revision==='runtime-139');
          }catch(e){diagnostics.runtime_verified=false;diagnostics.runtime_proof_reason=/^[A-Z_]+$/.test(e?.message)?e.message:'RUNTIME_PROOF_UNAVAILABLE';}
        }
        try{const remote=await bridge.send(cfg().dispatcherReportEndpoint,{action:'report_status',request_id:crypto.randomUUID()});if(!remote?.ok)throw new Error(remote?.code||'REPORT_NETWORK_ERROR');diagnostics.report={written_tickets:remote.active_count,earliest_report:remote.earliest_date||'UNKNOWN',latest_report:remote.latest_date||'UNKNOWN'};}catch(e){diagnostics.connection=/^[A-Z_]+$/.test(e?.message)?e.message:'REPORT_NETWORK_ERROR';}
        message(JSON.stringify(diagnostics));return;
      }
      if(action==='save'){const value=document.getElementById('dispatcherReportEndpoint').value.trim();const enabled=document.getElementById('dispatcherReportEnabled').checked;const validated=value?endpoint(value):'';if(enabled&&!validated)throw new Error('REPORT_NOT_CONFIGURED');const changed=cfg().dispatcherReportEndpoint!==validated;cfg().dispatcherReportEndpoint=validated;cfg().dispatcherReportEnabled=enabled;saveSettings();if(changed)bridge.close();outbox.reconfigure();renderSettings();message('Окремі налаштування збережено. Стару синхронізацію не змінено.');return;}
      if(action==='authorize'){record('authorize_start',{code:'AUTHORIZE_START',connected:false,verified:false});message('Google авторизацію виконуємо. Перевіряємо канал звіту...');await bridge.authorize(cfg().dispatcherReportEndpoint);record('connection_state',{code:'AUTHORIZED',connected:true,verified:true});message('Таблиця Д підключена');void outbox.flush();return;}
      if(action==='copyDiagnostics'){
        const payload=await collectDiagnostics(),text=JSON.stringify(payload,null,2);
        let copied=false;
        try{if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(text);copied=true;}}catch(_){copied=false;}
        if(!copied){
          try{
            const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.left='-9999px';document.body.appendChild(area);area.select();copied=document.execCommand('copy');document.body.removeChild(area);
          }catch(_){copied=false;}
        }
        message(copied?'Діагностику скопійовано. Приватні дані заявок не включаються.':'Не вдалося скопіювати. '+text);return;
      }
      const response=await bridge.send(cfg().dispatcherReportEndpoint,{action:action==='rebuild'?'report_rebuild':'report_status',request_id:crypto.randomUUID()},true);
      if(!response?.ok)throw new Error(response?.code||'REPORT_NETWORK_ERROR');
      // Preflight the authenticated connection before adding every ticket.
      if(action==='sync'){
        message('Переносимо весь локальний архів. Не закривайте застосунок.');await outbox.syncAll();
        const status=await bridge.send(cfg().dispatcherReportEndpoint,{action:'report_status',request_id:crypto.randomUUID()});
        if(!status?.ok)throw new Error(status?.code||'REPORT_NETWORK_ERROR');
        const source=typeof tickets==='undefined'?[]:tickets,ids=source.map(t=>String(t.id)).sort();
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(ids)))),n=>n.toString(16).padStart(2,'0')).join('');
        outbox.confirmArchive(status,hash,source.length);
        message(`Весь архів підтверджено: ${source.length} / ${status.active_count}. Дати: ${status.earliest_date||'—'} — ${status.latest_date||'—'}.`);return;
      }
      if(action==='retry'){outbox.retry();await outbox.flush();message('Повтор черги завершено. Перевірте стан каналу.');return;}
      outbox.connectionReady();message(action==='rebuild'?'Видимий звіт перебудовано.':`Підключено. Активних нарядів: ${Number(response.active_count)||0}; видалених: ${Number(response.deleted_count)||0}.`);
    }catch(e){message('Звіт не відправлено. '+(/^[A-Z_]+$/.test(e?.message)?e.message:'REPORT_NETWORK_ERROR')+'. Локальні заявки та стара синхронізація не змінені.');}
    finally{activeActions.delete(action);button.disabled=false;button.removeAttribute('aria-busy');refreshUI();}
  });
  async function resume(){
    refreshUI();
    try{
      if(await bridge.resume()){
        const b=bridge.diagnostics();record('connection_state',{code:'RESUMED',connected:!!b.connected,verified:!!b.verified});
        message('Таблиця Д підключена');await outbox.flush();
      }else if(cfg().dispatcherReportEndpoint){
        const b=bridge.diagnostics();record('connection_state',{code:'GOOGLE_CONNECTION_REQUIRED',connected:!!b.connected,verified:!!b.verified});
        message('Google-сеанс не відновлено. Натисніть «Відкрити Google-підключення», дочекайтеся підтвердження каналу та поверніться в застосунок. Черга збережена.');
      }
    }catch(e){
      const code=/^[A-Z_]+$/.test(e?.message)?e.message:'REPORT_NETWORK_ERROR';
      record('connection_state',{code,connected:false,verified:false});
      message('Канал звіту не підтверджено: '+code);
    }
  }
  // Auto-send entry point (v91.94): after a local save the app itself restores
  // the Таблиця Д channel and flushes the queue — no Settings visit needed.
  // Layers: (1) live peer resume, (2) silent re-attach to the session's named
  // bridge window, (3) ONE auto-connect window inside the save gesture with a
  // cooldown. Google auth is never bypassed; an expired Google session fails
  // honestly and the durable queue simply waits for the next safe recovery.
  let autoConnectAt=0;
  async function ensureChannel(){
    if(!cfg().dispatcherReportEndpoint||!cfg().dispatcherReportEnabled)return false;
    if(outbox.status().unresolved<=0)return false;
    try{
      if(await bridge.resume()){
        const b=bridge.diagnostics();record('connection_state',{code:'RESUMED',connected:!!b.connected,verified:!!b.verified});
        void outbox.flush();return true;
      }
    }catch(e){
      const code=/^[A-Z_]+$/.test(e?.message)?e.message:'REPORT_NETWORK_ERROR';
      record('connection_state',{code,connected:false,verified:false});
    }
    if(Date.now()-autoConnectAt<180000)return false;
    autoConnectAt=Date.now();
    try{
      message('Відновлюємо канал Таблиці Д…');
      await bridge.authorize(cfg().dispatcherReportEndpoint);
      record('connection_state',{code:'AUTO_CONNECTED',connected:true,verified:true});
      message('Таблиця Д підключена');
      void outbox.flush();
      return true;
    }catch(e){
      const code=/^[A-Z_]+$/.test(e?.message)?e.message:'GOOGLE_CONNECTION_REQUIRED';
      record('connection_state',{code,connected:false,verified:false});
      message('Канал Таблиці Д не відновлено автоматично ('+code+'). Черга збережена — надішлемо при наступному відновленні.');
      return false;
    }
  }
  window.addEventListener('online',resume);window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')resume();});document.addEventListener('DOMContentLoaded',resume);
  root.MTDispatcherReport=Object.freeze({...outbox,renderSettings,badge,ensureChannel,enabled:()=>!!cfg().dispatcherReportEnabled});
})(typeof globalThis==='object'?globalThis:this);
