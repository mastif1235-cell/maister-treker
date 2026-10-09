/* Safe operational telemetry for the dispatcher report channel (Таблиця Д).
   Ring buffer in localStorage key mtDispatcherTelemetryV1, max 200 events.
   Privacy contract: ONLY the whitelisted metadata fields survive — no ticket
   IDs, phone, name, address, MAC, notes, content, credentials or endpoint.
   Values are coerced to: non-negative integers, booleans, strict UPPER_CASE
   codes and the runtime revision tokens emitted by our own modules. */
(function(root){
  'use strict';
  const KEY='mtDispatcherTelemetryV1',MAX=200,QUEUE_STATE_MIN_INTERVAL_MS=60000;
  const EVENTS=Object.freeze(['ticket_saved','enqueue_attempt','enqueue_result','operation_persisted','flush_attempt','store_not_ready','lookup_miss','connection_state','authorize_start','report_status_ack','send_attempt','send_result','ack_received','runtime_guard','queue_state']);
  const EVENT_SET=new Set(EVENTS);
  const NUMERIC=new Set(['pending','failed','unresolved','batch_size','ack_count']);
  const BOOLEANS=new Set(['store_ready','module_present','connected','verified']);
  const FIELDS=Object.freeze(['timestamp','event','code','pending','failed','unresolved','store_ready','module_present','connected','verified','batch_size','ack_count','runtime_expected','runtime_actual']);
  const FIELD_SET=new Set(FIELDS);
  const CODE=/^[A-Z][A-Z0-9_]{1,63}$/;
  const RUNTIME_TOKEN=/^runtime-\d{1,4}(\+(?:runtime-\d{1,4}|MISSING)){0,4}$/;
  function load(){
    try{
      const raw=JSON.parse((root.localStorage&&root.localStorage.getItem(KEY))||'[]');
      return Array.isArray(raw)?raw.filter(e=>e&&typeof e==='object'&&typeof e.event==='string').slice(-MAX):[];
    }catch(_){return [];}
  }
  function save(events){
    try{
      if(root.localStorage)root.localStorage.setItem(KEY,JSON.stringify(events.slice(-MAX)));
    }catch(_){/* storage unavailable — telemetry must never break the app */}
  }
  function sanitize(key,value){
    if(NUMERIC.has(key)){
      const n=Number(value);
      return Number.isFinite(n)&&n>=0?Math.min(Math.floor(n),1e9):undefined;
    }
    if(BOOLEANS.has(key))return typeof value==='boolean'?value:undefined;
    if(key==='code')return typeof value==='string'&&CODE.test(value)?value:undefined;
    if(key==='runtime_expected'||key==='runtime_actual')return typeof value==='string'&&RUNTIME_TOKEN.test(value)?value:undefined;
    return undefined;
  }
  function record(event,fields){
    try{
      if(!EVENT_SET.has(event))return false;
      const events=load();
      if(event==='queue_state'){
        const last=events.filter(e=>e.event==='queue_state').at(-1);
        if(last&&Date.now()-Number(last.timestamp||0)<QUEUE_STATE_MIN_INTERVAL_MS)return false;
      }
      const entry={timestamp:Date.now(),event};
      if(fields&&typeof fields==='object'&&!Array.isArray(fields)){
        for(const key of Object.keys(fields)){
          if(!FIELD_SET.has(key)||key==='timestamp'||key==='event')continue;
          const safe=sanitize(key,fields[key]);
          if(safe!==undefined)entry[key]=safe;
        }
      }
      events.push(entry);
      save(events);
      return true;
    }catch(_){return false;}
  }
  function dump(){return load();}
  function clear(){try{if(root.localStorage)root.localStorage.removeItem(KEY);}catch(_){}}
  root.MTDispatcherTelemetry=Object.freeze({KEY,MAX,FIELDS,EVENTS,record,dump,clear});
})(typeof globalThis==='object'?globalThis:this);
