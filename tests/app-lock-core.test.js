'use strict';
const assert=require('node:assert/strict');
const lock=require('../js/app-lock-core.js');
(async()=>{
  const salt=lock.bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
  const a=await lock.verifier('correct-password',salt),b=await lock.verifier('wrong-password',salt);
  assert.equal(lock.constantTimeEqual(a,a),true);assert.equal(lock.constantTimeEqual(a,b),false);
  let state={};for(let i=0;i<4;i++)state=lock.recordFailure(state,1000);assert.equal(lock.remainingMs(state,1000),0);
  state=lock.recordFailure(state,1000);assert.equal(lock.remainingMs(state,1000),2000);
  const persisted=JSON.parse(JSON.stringify(state));assert.equal(lock.remainingMs(persisted,2000),1000);assert.equal(lock.remainingMs(persisted,4000),0);
  console.log('PASS lock PBKDF2/constant-time/throttling/reload state');
})().catch(e=>{console.error(e);process.exitCode=1;});
