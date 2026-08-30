'use strict';
const assert=require('node:assert/strict');
const transport=require('../js/sync-transport.js');
const secret='0123456789abcdef0123456789abcdef'; let nonce=0;
const random=()=>`nonce_${++nonce}_abcdefghijklmnop`;
const mutation={entity:'ticket',id:'t1',action:'addTicket',revision:1,requestId:'mt.request_abcdefghijkl',body:{action:'addTicket',id:'t1',revision:1,date:'23.08.2026',time:'10:00',content:'x',sum:1,tags:[]}};
(async()=>{
  const fingerprint=await transport.semanticFingerprint(mutation);
  let posts=0;
  const readable=transport.create({url:()=>'/gas',secret:()=>secret,random,now:()=>1787472000000,
    fetch:async(_url,opt)=>{posts++; assert.equal(opt.mode,'cors'); return {ok:true,json:async()=>({status:'ok',state:{revision:1,tombstone:false,fingerprint}})};}});
  assert.equal((await readable.send(mutation)).ok,true); assert.equal(posts,1);
  let calls=[];
  const timeoutRecovery=transport.create({url:()=>'/gas',secret:()=>secret,random,now:()=>1787472000000,verifyDelays:[0],
    fetch:async(url,opt)=>{calls.push({url,opt});if(opt.method==='POST')throw new Error('timeout');return{ok:true,json:async()=>({status:'ok',state:{revision:1,tombstone:false,fingerprint}})};}});
  assert.equal((await timeoutRecovery.send(mutation)).ok,true,'timeout/lost readable response repaired by state GET');
  assert.equal(calls.length,2); assert.equal(calls[0].opt.mode,'cors');
  assert.match(calls[1].url,/action=getEntityState/); assert.doesNotMatch(calls[1].url,/secret=/);
  const first=JSON.parse(calls[0].opt.body); calls=[]; await timeoutRecovery.send(mutation); const retry=JSON.parse(calls[0].opt.body);
  assert.equal(first.requestId,retry.requestId,'retry requestId stable'); assert.notEqual(first.nonce,retry.nonce,'retry nonce fresh');
  const conflictVerify=transport.create({url:()=>'/gas',secret:()=>secret,random,now:()=>1787472000000,verifyDelays:[0],
    fetch:async(_url,opt)=>{if(opt.method==='POST')throw new Error('timeout');return{ok:true,json:async()=>({status:'ok',state:{revision:1,tombstone:false,fingerprint:'different'}})};}});
  const verifiedConflict=await conflictVerify.send(mutation);
  assert.equal(verifiedConflict.ok,false,'same revision/different fingerprint never acknowledged');
  assert.equal(verifiedConflict.result.code,'CONFLICT','lost POST response still becomes a durable conflict instead of a transient retry');
  const reads=[];
  const conflictRead=transport.create({url:()=>'/gas',secret:()=>secret,random,now:()=>1787472000000,
    fetch:async(url,opt)=>{reads.push({url,opt});return{ok:true,json:async()=>String(url).includes('getTicketById')?{status:'ok',ticket:{id:'t1',content:'server'}}:{status:'ok',state:{revision:2,tombstone:false,fingerprint:'server'}}};}});
  assert.equal((await conflictRead.getEntityState('ticket','t1')).result.state.revision,2,'conflict resolver reads current server revision');
  assert.equal((await conflictRead.getTicket('t1')).result.ticket.content,'server','conflict resolver reads current server ticket');
  assert.match(reads[0].url,/action=getEntityState/);assert.match(reads[1].url,/action=getTicketById/);
  assert.ok(reads.every(call=>call.opt.method==='GET'&&call.opt.mode==='cors'),'conflict reads use signed readable CORS GET');
  assert.ok(reads.every(call=>!String(call.url).includes(secret)),'conflict read URL never contains the HMAC secret');
  console.log('PASS canonical readable CORS transport and lost-response verification');
})().catch(e=>{console.error(e);process.exitCode=1;});
