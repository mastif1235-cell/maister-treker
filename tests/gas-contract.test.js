'use strict';

const assert = require('node:assert/strict');
const cryptoNode = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const client = require('../js/sync-contract.js');
const fixture = require('./fixtures/sync-contract-v3-vectors.json');

const properties = new Map([['MT_SYNC_HMAC_SECRET', fixture.secret]]);
const cache = new Map();
const scriptProperties = {
  getProperty(key){ return properties.get(key) || null; },
  setProperty(key, value){ properties.set(key, String(value)); },
  deleteProperty(key){ properties.delete(key); },
  getProperties(){ return Object.fromEntries(properties); }
};

const Utilities = {
  Charset: {UTF_8:'UTF_8'},
  DigestAlgorithm: {SHA_256:'SHA_256'},
  newBlob(value){ return {getBytes(){ return [...Buffer.from(String(value), 'utf8')]; }}; },
  base64EncodeWebSafe(bytes){ return Buffer.from(bytes).toString('base64url'); },
  computeDigest(_algorithm, value){ return cryptoNode.createHash('sha256').update(String(value), 'utf8').digest(); },
  computeHmacSha256Signature(value, secret){ return cryptoNode.createHmac('sha256', String(secret)).update(String(value), 'utf8').digest(); },
  formatDate(){ throw new Error('not used by contract tests'); }
};

const context = vm.createContext({
  Array, Date, JSON, Math, Number, Object, RegExp, String,
  Utilities,
  PropertiesService: {getScriptProperties(){ return scriptProperties; }},
  CacheService: {getScriptCache(){ return {
    get(key){ return cache.get(key) || null; },
    put(key, value){ cache.set(key, String(value)); }
  }; }},
  LockService: {getScriptLock(){ return {waitLock(){}, releaseLock(){}}; }},
  ContentService: {
    MimeType: {JSON:'JSON'},
    createTextOutput(text){ return {text, setMimeType(){ return this; }}; }
  }
});

vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), context, {filename:'Code.gs'});

function serverSignature(request){
  return context.syncExpectedSignature_(context.syncCanonicalRequest_(request));
}

async function signed(request, secret = fixture.secret){
  return {...request, sig:await client.sign(request, secret)};
}

async function run(){
  for(const vector of fixture.vectors){
    assert.equal(await client.sign(vector.request, fixture.secret), vector.signature, `client vector: ${vector.name}`);
    assert.equal(serverSignature(vector.request), vector.signature, `server vector: ${vector.name}`);
    assert.equal(context.syncCanonicalRequest_(vector.request), client.canonical(vector.request), `canonical parity: ${vector.name}`);
  }

  const now = Date.now();
  const base = {
    v:3, method:'POST', action:'updateTicket', entity:'ticket', id:'abc-123',
    ts:String(now), nonce:'nonce-abcdefghijklmnop', requestId:'request-abcdefghijkl',
    body:JSON.stringify({action:'updateTicket', id:'abc-123', revision:1, date:'23.08.2026', time:'10:00', content:'ok', sum:100, tags:[]})
  };
  const valid = await signed(base);
  assert.equal(context.syncVerifyEnvelope_(valid, 'POST').ok, true, 'valid signature');

  assert.equal(context.syncVerifyEnvelope_({...valid, sig:'bad'}, 'POST').code, 'AUTH_FAILED', 'malformed signature');
  assert.equal(context.syncVerifyEnvelope_({...valid, ts:String(now - 6 * 60 * 1000)}, 'POST').code, 'AUTH_FAILED', 'expired timestamp');
  assert.equal(context.syncVerifyEnvelope_({...valid, body:valid.body + ' '}, 'POST').code, 'AUTH_FAILED', 'modified body');

  properties.set('MT_SYNC_HMAC_SECRET', 'fedcba9876543210fedcba9876543210');
  assert.equal(context.syncVerifyEnvelope_(valid, 'POST').code, 'AUTH_FAILED', 'wrong key');
  properties.set('MT_SYNC_HMAC_SECRET', fixture.secret);

  const oversized = {...base, body:'x'.repeat(context.SYNC_MAX_BODY_BYTES + 1)};
  oversized.sig = 'A'.repeat(43);
  assert.equal(context.syncVerifyEnvelope_(oversized, 'POST').code, 'REQUEST_TOO_LARGE', 'oversized payload');

  const unsafeData = JSON.parse('{"action":"updateTicket","id":"abc-123","date":"23.08.2026","time":"10:00","content":"ok","sum":100,"tags":[],"__proto__":{"polluted":true}}');
  assert.equal(context.syncValidatePostData_(unsafeData, base).code, 'INVALID_INPUT', 'prototype keys rejected');
  assert.equal(context.syncValidTicket_({...JSON.parse(base.body), date:'32.08.2026'}), false, 'invalid calendar date rejected');

  cache.clear();
  assert.equal(context.syncConsumeNonce_('nonce-replay-abcdefghijkl'), true, 'first nonce accepted');
  assert.equal(context.syncConsumeNonce_('nonce-replay-abcdefghijkl'), false, 'reused nonce rejected');

  for(const key of [...properties.keys()]) if(key.startsWith('MT_SYNC_IDEM_')) properties.delete(key);
  cache.clear();
  let executions = 0;
  const realSyncExecutePost = context.syncExecutePost_;
  context.syncExecutePost_ = function(_data, envelope){ executions++; return {status:'ok', requestId:envelope.requestId}; };
  const first = await signed({...base, nonce:'nonce-first-abcdefghijkl'});
  const exactRetry = {...first};
  const retry = await signed({...base, ts:String(Date.now()), nonce:'nonce-retry-abcdefghijkl'});
  const firstResponse = context.doPost({postData:{contents:JSON.stringify(first)}});
  const exactRetryResponse = context.doPost({postData:{contents:JSON.stringify(exactRetry)}});
  const retryResponse = context.doPost({postData:{contents:JSON.stringify(retry)}});
  assert.equal(JSON.parse(firstResponse.text).status, 'ok', 'first mutation accepted');
  assert.equal(JSON.parse(exactRetryResponse.text).status, 'ok', 'exact lost-response retry accepted');
  assert.equal(JSON.parse(retryResponse.text).status, 'ok', 'lost-response retry accepted');
  assert.equal(executions, 1, 'same requestId executes once');

  const collisionBody = JSON.stringify({...JSON.parse(base.body), content:'changed'});
  const collision = await signed({...base, ts:String(Date.now()), nonce:'nonce-conflict-abcdefgh', body:collisionBody});
  assert.equal(JSON.parse(context.doPost({postData:{contents:JSON.stringify(collision)}}).text).code, 'IDEMPOTENCY_CONFLICT', 'requestId collision rejected');
  context.syncExecutePost_ = realSyncExecutePost;

  let durableState = {entityType:'ticket', entityId:'state-1', revision:0, tombstone:false, fingerprint:'', requestId:'', rowIndex:-1};
  context.syncReadEntityState_ = ()=>({...durableState});
  context.syncWriteEntityState_ = (_ss, state)=>{ durableState = {...state, rowIndex:2}; };
  context.addTicketRow = ()=>{};
  context.updateTicketRow = ()=>{};
  context.deleteRowById = ()=>{};
  context.getOrCreateSheet = ()=>({});
  const entityEnvelope = {v:3, method:'POST', action:'addTicket', entity:'ticket', id:'state-1', requestId:'state-request-0001'};
  const entityBody = JSON.stringify({action:'addTicket', id:'state-1', revision:1, date:'23.08.2026', time:'10:00', content:'create', sum:1, tags:[]});
  entityEnvelope.body = entityBody;
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(entityBody), entityEnvelope).outcome, 'APPLIED', 'revision 1 applied');
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(entityBody), entityEnvelope).outcome, 'IDEMPOTENT_SUCCESS', 'same revision/fingerprint after cache expiry');
  const differentBody = JSON.stringify({...JSON.parse(entityBody), content:'different'});
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(differentBody), {...entityEnvelope, body:differentBody}).code, 'CONFLICT', 'same revision/different fingerprint');
  const gapBody = JSON.stringify({...JSON.parse(entityBody), action:'updateTicket', revision:3});
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(gapBody), {...entityEnvelope, action:'updateTicket', body:gapBody}).code, 'REVISION_GAP', 'revision gaps rejected');
  const updateBody = JSON.stringify({...JSON.parse(entityBody), action:'updateTicket', revision:2, content:'latest'});
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(updateBody), {...entityEnvelope, action:'updateTicket', requestId:'state-request-0002', body:updateBody}).outcome, 'APPLIED', 'next revision applied');
  const deleteBody = JSON.stringify({action:'deleteTicket', id:'state-1', revision:3});
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(deleteBody), {...entityEnvelope, action:'deleteTicket', requestId:'state-request-0003', body:deleteBody}).outcome, 'APPLIED', 'delete tombstone applied');
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(updateBody), {...entityEnvelope, action:'updateTicket', body:updateBody}).outcome, 'STALE', 'delayed old update is stale');
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(entityBody), entityEnvelope).outcome, 'STALE', 'delayed old create is stale');
  const resurrectBody = JSON.stringify({...JSON.parse(entityBody), action:'updateTicket', revision:4});
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(resurrectBody), {...entityEnvelope, action:'updateTicket', body:resurrectBody}).code, 'TOMBSTONED', 'new update cannot remove tombstone');
  assert.deepEqual(JSON.parse(JSON.stringify(context.syncPublicEntityState_(durableState))), {exists:false, revision:3, tombstone:true, fingerprint:durableState.fingerprint}, 'minimal entity state');

  durableState = {entityType:'shift', entityId:'shift-1', revision:0, tombstone:false, fingerprint:'', requestId:'', rowIndex:-1};
  context.addShiftRow = ()=>{};
  context.syncGetCanonicalShiftSheet_ = ()=>({});
  context.refreshShiftReport_ = ()=>{};
  const shiftAddBody=JSON.stringify({action:'addShift',id:'shift-1',revision:1,date:'23.08.2026',hours:8,coworker:'Сам'});
  const shiftEnvelope={entity:'shift',id:'shift-1',action:'addShift',requestId:'shift-request-0001',body:shiftAddBody};
  assert.equal(context.syncExecuteEntityMutation_({},JSON.parse(shiftAddBody),shiftEnvelope).outcome,'APPLIED','shift create parity');
  const shiftUpdateBody=JSON.stringify({...JSON.parse(shiftAddBody),action:'updateShift',revision:2,hours:9});
  assert.equal(context.syncExecuteEntityMutation_({},JSON.parse(shiftUpdateBody),{...shiftEnvelope,action:'updateShift',requestId:'shift-request-0002',body:shiftUpdateBody}).outcome,'APPLIED','shift update parity');
  const shiftDeleteBody=JSON.stringify({action:'deleteShift',id:'shift-1',revision:3});
  assert.equal(context.syncExecuteEntityMutation_({},JSON.parse(shiftDeleteBody),{...shiftEnvelope,action:'deleteShift',requestId:'shift-request-0003',body:shiftDeleteBody}).outcome,'APPLIED','shift delete parity');

  const adminResult = context.syncExecutePost_({}, {entity:'system', action:'syncAll', id:'', requestId:'admin-request-0001'});
  assert.equal(adminResult.code, 'ADMIN_RECOVERY_REQUIRED', 'full sync cannot bypass revision/tombstones');

  console.log(`PASS ${fixture.vectors.length} client vectors`);
  console.log(`PASS ${fixture.vectors.length} server vectors`);
  console.log('PASS auth/idempotency/revision/tombstone/full-sync safety cases');
}

run().catch((error)=>{ console.error(error); process.exitCode = 1; });
