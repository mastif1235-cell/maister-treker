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
    body:JSON.stringify({action:'updateTicket', id:'abc-123', date:'23.08.2026', time:'10:00', content:'ok', sum:100, tags:[]})
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

  console.log(`PASS ${fixture.vectors.length} client vectors`);
  console.log(`PASS ${fixture.vectors.length} server vectors`);
  console.log('PASS malformed/expired/replay/modified/wrong-key/oversized/idempotency cases');
}

run().catch((error)=>{ console.error(error); process.exitCode = 1; });
