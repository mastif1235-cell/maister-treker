(function(root, factory){
  const api = factory(root.MasterTrackerSyncContract || (typeof require === 'function' ? require('./sync-contract.js') : null));
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.MTSyncTransport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(contract){
  'use strict';
  function token(random){ return random().replace(/[^A-Za-z0-9_-]/g,'').slice(0,80); }
  async function signedEnvelope(mutation, secret, random, now){
    const envelope = {v:contract.VERSION, method:'POST', action:mutation.action, entity:mutation.entity,
      id:String(mutation.id), ts:String(now()), nonce:token(random), requestId:mutation.requestId,
      body:JSON.stringify(mutation.body)};
    envelope.sig = await contract.sign(envelope, secret); return envelope;
  }
  async function signedStateUrl(url, mutation, secret, random, now){
    const envelope = {v:contract.VERSION, method:'GET', action:'getEntityState', entity:mutation.entity,
      id:String(mutation.id), ts:String(now()), nonce:token(random), requestId:'', body:''};
    envelope.sig = await contract.sign(envelope, secret);
    return url + (url.includes('?')?'&':'?') + new URLSearchParams(envelope).toString();
  }
  async function fetchTimed(fetchImpl, url, options, timeoutMs){
    const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(), timeoutMs);
    try{return await fetchImpl(url, Object.assign({}, options, {signal:controller.signal}));} finally{clearTimeout(timer);}
  }
  function create(options){
    const fetchImpl=options.fetch, random=options.random, now=options.now || Date.now;
    async function verify(mutation){
      const delays=options.verifyDelays || [0,250,500,1000];
      for(const delay of delays){
        if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
        try{
          const url=await signedStateUrl(options.url(),mutation,options.secret(),random,now);
          const response=await fetchTimed(fetchImpl,url,{method:'GET',mode:'cors'},options.verifyTimeoutMs||2500);
          if(!response.ok) continue;
          const data=await response.json(); const state=data && data.state;
          if(state && Number(state.revision)>=mutation.revision) return {ok:true,state};
          if(state && state.tombstone) return {ok:true,state};
        }catch(_err){}
      }
      return {ok:false};
    }
    async function send(mutation){
      const envelope=await signedEnvelope(mutation,options.secret(),random,now);
      const mode=options.responseMode();
      try{
        const response=await fetchTimed(fetchImpl,options.url(),{method:'POST',mode:mode==='readable'?'cors':'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(envelope)},options.postTimeoutMs||5000);
        if(mode==='readable'){
          const result=await response.json();
          if(response.ok && result.status==='ok') return {ok:true,state:result.state,result};
          return {ok:false,result};
        }
      }catch(err){ if(mode==='readable') return {ok:false,error:err}; }
      return verify(mutation);
    }
    return {send,verify};
  }
  return {create,signedEnvelope,signedStateUrl};
});
