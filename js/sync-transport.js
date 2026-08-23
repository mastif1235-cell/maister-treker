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
  async function semanticFingerprint(mutation){
    const value=[mutation.entity,String(mutation.id),mutation.action,String(mutation.revision),JSON.stringify(mutation.body)].map(contract.field).join('\n');
    const digest=await crypto.subtle.digest('SHA-256',contract.utf8Bytes(value));
    return (function(bytes){let binary='';new Uint8Array(bytes).forEach(b=>binary+=String.fromCharCode(b));return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');})(digest);
  }
  function create(options){
    const fetchImpl=options.fetch, random=options.random, now=options.now || Date.now;
    async function verify(mutation){
      const delays=options.verifyDelays || [250,500,1000];
      const expectedFingerprint=await semanticFingerprint(mutation);
      for(const delay of delays){
        if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
        try{
          const url=await signedStateUrl(options.url(mutation),mutation,options.secret(),random,now);
          const response=await fetchTimed(fetchImpl,url,{method:'GET',mode:'cors'},options.verifyTimeoutMs||1000);
          if(!response.ok) continue;
          const data=await response.json(); const state=data && data.state;
          if(state && Number(state.revision)>mutation.revision) return {ok:true,state};
          if(state && Number(state.revision)===mutation.revision && state.fingerprint===expectedFingerprint) return {ok:true,state};
        }catch(_err){}
      }
      return {ok:false};
    }
    async function send(mutation){
      const envelope=await signedEnvelope(mutation,options.secret(),random,now);
      try{
        const response=await fetchTimed(fetchImpl,options.url(mutation),{method:'POST',mode:'cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(envelope)},options.postTimeoutMs||5000);
        const result=await response.json();
        if(response.ok && result.status==='ok') return {ok:true,state:result.state,result};
        return {ok:false,result};
      }catch(err){ return verify(mutation); }
    }
    return {send,verify};
  }
  return {create,signedEnvelope,signedStateUrl,semanticFingerprint};
});
