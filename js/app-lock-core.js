(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MTAppLockCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const ITERATIONS=210000,MAX_FAILURES=5,BASE_DELAY_MS=2000,MAX_DELAY_MS=300000;
  const enc=new TextEncoder();
  function bytesToBase64(bytes){let out='';for(const b of bytes)out+=String.fromCharCode(b);return btoa(out);}
  function base64ToBytes(value){return Uint8Array.from(atob(String(value||'')),c=>c.charCodeAt(0));}
  function constantTimeEqual(a,b){const x=String(a||''),y=String(b||'');let diff=x.length^y.length,max=Math.max(x.length,y.length);for(let i=0;i<max;i++)diff|=(x.charCodeAt(i%Math.max(x.length,1))||0)^(y.charCodeAt(i%Math.max(y.length,1))||0);return diff===0;}
  async function verifier(password,saltB64,iterations=ITERATIONS){const material=await crypto.subtle.importKey('raw',enc.encode(String(password)),{name:'PBKDF2'},false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:base64ToBytes(saltB64),iterations:Number(iterations)||ITERATIONS},material,256);return bytesToBase64(new Uint8Array(bits));}
  function recordFailure(state,now=Date.now()){const failures=Math.max(0,Number(state?.failures)||0)+1;const exponent=Math.max(0,failures-MAX_FAILURES);const delay=failures<MAX_FAILURES?0:Math.min(MAX_DELAY_MS,BASE_DELAY_MS*(2**exponent));return{failures,nextAllowedAt:delay?now+delay:0};}
  function remainingMs(state,now=Date.now()){return Math.max(0,(Number(state?.nextAllowedAt)||0)-now);}
  return{ITERATIONS,MAX_FAILURES,bytesToBase64,base64ToBytes,constantTimeEqual,verifier,recordFailure,remainingMs};
});
