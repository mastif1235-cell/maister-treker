/* Mixed-runtime self-heal guard for the installed PWA (v91.93 / runtime-138).
   A page whose module revisions (app, dispatcher client, tickets renderer,
   compact view) or Service Worker runtime disagree is a mixed runtime: the
   dispatcher flush MUST NOT run against it and the queue must survive.
   Policy: exactly one automatic reload (sessionStorage loop-guard) — after a
   live SW swap this lands on the new runtime and the app self-heals; if the
   mismatch persists the guard fails CLOSED (dispatcher flush suppressed,
   diagnostics available in Settings) and NEVER touches user data. */
(function(root){
  'use strict';
  const EXPECTED='runtime-138';
  const CACHE_EXPECTED='maister-treker-v68-runtime-138';
  const RELOAD_GUARD_KEY='mtRuntimeGuardReloadV1';
  const TOKEN=/^runtime-\d{1,4}$/;
  function storage(kind){
    try{return root[kind]||null;}catch(_){return null;}
  }
  function revisions(){
    return {
      app:root.MTAppRuntimeRevision||'MISSING',
      report:root.MTDispatcherReportClient&&root.MTDispatcherReportClient.runtimeRevision||'MISSING',
      renderer:root.MTTicketRendererRevision||'MISSING',
      compact:root.MTTicketCompactView&&root.MTTicketCompactView.runtimeRevision||'MISSING'
    };
  }
  /* SW cache name may carry release-suffixes from test flows
     (…-e2e-update); the RUNTIME marker inside it is what must agree. */
  function swRuntimeFromCacheName(cacheName){
    const m=/runtime-(\d{1,4})/.exec(String(cacheName||''));
    return m?'runtime-'+m[1]:(cacheName?String(cacheName):'');
  }
  function evaluate(revs,swCacheName){
    const details={};
    let ok=true;
    for(const key of Object.keys(revs||{})){
      details[key]=revs[key];
      if(String(revs[key])!==EXPECTED)ok=false;
    }
    const swRuntime=swRuntimeFromCacheName(swCacheName);
    if(swRuntime&&swRuntime!==EXPECTED)ok=false;
    return {ok,details,sw_cache:String(swCacheName||''),sw_runtime:swRuntime};
  }
  let state='pending',reason='',verdict=null;
  function record(event,fields){
    try{
      const t=root.MTDispatcherTelemetry;
      if(t&&typeof t.record==='function')t.record(event,fields);
    }catch(_){/* telemetry must never break the guard */}
  }
  function runtimeField(value){return TOKEN.test(String(value||''))?String(value):'MISSING';}
  function reportVerdict(code,revs){
    const expected=runtimeField(EXPECTED);
    for(const key of Object.keys(revs||{})){
      record('runtime_guard',{code,connected:false,verified:false,runtime_expected:expected,runtime_actual:runtimeField(revs[key])});
    }
  }
  function handleMismatch(verdictValue){
    reason='MIXED_RUNTIME';
    const session=storage('sessionStorage');
    let fired=false;
    try{fired=session?session.getItem(RELOAD_GUARD_KEY)==='1':false;}catch(_){fired=false;}
    if(!fired){
      state='reloading';
      try{if(session)session.setItem(RELOAD_GUARD_KEY,'1');}catch(_){/* best effort */}
      reportVerdict('RUNTIME_MISMATCH_RELOAD',verdictValue.details);
      const reload=root.location&&root.location.reload;
      if(typeof reload==='function'){
        try{reload.call(root.location);}catch(_){/* blocked reload falls through to fail-closed */}
        return;
      }
    }
    state='failed';
    reportVerdict('RUNTIME_MISMATCH_CLOSED',verdictValue.details);
  }
  function checkModules(){
    const revs=revisions();
    verdict=evaluate(revs,null);
    if(!verdict.ok){
      handleMismatch(verdict);
      return false;
    }
    return true;
  }
  function checkServiceWorker(){
    if(state!=='pending')return;
    if(!verdict||!verdict.ok)return;
    const nav=root.navigator;
    if(!nav||!nav.serviceWorker||typeof root.MessageChannel!=='function')return;
    const sw=nav.serviceWorker,channel=new root.MessageChannel();
    let settled=false;
    const done=value=>{
      if(settled)return;
      settled=true;
      const cacheName=value&&value.cacheName?v_sw_name(value):'';
      const swVerdict=evaluate(verdict.details,cacheName);
      verdict=swVerdict;
      if(!swVerdict.ok)handleMismatch(swVerdict);
      else{
        state='ok';
        reason='';
        try{const session=storage('sessionStorage');if(session)session.removeItem(RELOAD_GUARD_KEY);}catch(_){/* best effort */}
      }
    };
    function v_sw_name(value){return String(value.cacheName||'');}
    if(typeof sw.controller==='undefined'||!sw.controller){
      /* Not controlled yet: module revisions already agreed; SW will be
         verified on the next boot once a controller exists. */
      state='ok';
      reason='';
      return;
    }
    channel.port1.onmessage=event=>done(event.data||{});
    try{
      sw.controller.postMessage({type:'MT_RUNTIME_STATUS'},[channel.port2]);
      (root.setTimeout||setTimeout)(()=>{settled=true;if(state==='pending'){state='ok';reason='';}},2500);
    }catch(_){state='ok';reason='';}
  }
  function boot(){
    if(!checkModules())return;
    checkServiceWorker();
    if(state==='pending'){state='ok';}
  }
  function blocked(){return state!=='ok';}
  root.MTDispatcherRuntimeGuard=Object.freeze({EXPECTED,CACHE_EXPECTED,RELOAD_GUARD_KEY,revisions,evaluate,boot,state:()=>state,reason:()=>reason,blocked,checkServiceWorker});
  try{
    if(typeof document!=='undefined'&&document.readyState==='loading'&&typeof document.addEventListener==='function'){
      document.addEventListener('DOMContentLoaded',()=>{try{boot();}catch(_){/* fail closed */}},{once:true});
    }else boot();
  }catch(_){state='failed';}
})(typeof globalThis==='object'?globalThis:this);
