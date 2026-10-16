'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const {randomUUID} = require('node:crypto');
const transport = require('../js/sync-transport.js');
const harness = require('./helpers/sync-gas-harness.js');

// All requests stay inside the existing in-memory GAS/Sheets harness.
const TICKET = {id:'a02-synthetic-ticket', date:'01.02.2026', time:'10:00',
  content:'Synthetic baseline', type:'Ремонт', sum:100};
async function seed(server){
  const device = await harness.createDevice({server, name:'seed'});
  await device.addTicket(TICKET);
  return {tickets:harness.clone(device.ctx.tickets), journal:device.journal()};
}
function installWire(device, server, call){
  const wire = transport.create({url:()=> 'https://gas.harness.test/exec',
    secret:()=>server.secret, random:randomUUID, verifyDelays:[0],
    fetch:async (url, options)=>{
      const text = await call(options.method, String(url), options.body);
      return {ok:true, json:async()=>JSON.parse(text)};
    }});
  device.transport = wire;
  device.engine.transport = wire;
}

test('A02: newer device B state cannot acknowledge device A undelivered edit', async()=>{
  const server = harness.createServer();
  const baseline = await seed(server);
  const A = await harness.createDevice({server, name:'A', ...baseline, online:false});
  const B = await harness.createDevice({server, name:'B', ...baseline});
  await B.editTicket(TICKET.id, {content:'Synthetic device B revision 2'});
  await B.editTicket(TICKET.id, {content:'Synthetic device B revision 3'});
  assert.equal(server.state('ticket', TICKET.id).revision, 3);
  const serverBefore = harness.clone(server.ticketSheet.rows);
  let attempts = 0;
  installWire(A, server, (method, url, body)=>{
    if(method === 'POST'){ attempts++; throw new Error('Synthetic timeout before delivery'); }
    return server.call(method, url, body);
  });
  A.setOnline(true);
  await A.editTicket(TICKET.id, {content:'Synthetic undelivered device A edit'});
  const localBeforeRetry = harness.clone(A.ctx.tickets);
  const pending = A.record('ticket', TICKET.id);
  assert.equal(attempts, 1);
  assert.equal(A.engine.pendingCount(), 1, 'newer foreign fingerprint is not delivery evidence');
  assert.equal(A.isSynced('ticket', TICKET.id), false);
  assert.equal(pending.committedRevision, 1, 'foreign revision must not advance local ACK');
  assert.equal(pending.head.revision, 2);
  assert.notEqual(server.state('ticket', TICKET.id).fingerprint,
    await transport.semanticFingerprint(pending.head));
  assert.deepEqual(server.ticketSheet.rows, serverBefore, 'verification performs no server writes');

  // The pending request survives a restart; a readable retry returns genuine STALE.
  const restarted = await harness.createDevice({server, name:'A-restarted', online:false,
    tickets:localBeforeRetry, journal:A.journal()});
  restarted.setOnline(true);
  await restarted.flush();
  assert.equal(restarted.engine.pendingCount(), 1, 'STALE parks the edit instead of discarding it');
  assert.equal(restarted.isSynced('ticket', TICKET.id), false);
  assert.ok(restarted.conflict('ticket', TICKET.id));
  assert.equal(restarted.record('ticket', TICKET.id).head.requestId, pending.head.requestId);
  assert.equal(restarted.record('ticket', TICKET.id).committedRevision, 1);
  assert.deepEqual(restarted.ctx.tickets, localBeforeRetry, 'local ticket and money remain intact');
  assert.deepEqual(server.ticketSheet.rows, serverBefore, 'retry cannot overwrite device B');
  assert.equal(server.ticketIds().length, 1);
});

test('lost ACK overtaken by B recovers only through A original idempotent receipt', async()=>{
  const server = harness.createServer();
  const baseline = await seed(server);
  const A = await harness.createDevice({server, name:'A', ...baseline, online:false});
  const B = await harness.createDevice({server, name:'B', ...baseline});
  const envelopes = [];
  let loseResponse = true;
  installWire(A, server, async(method, url, body)=>{
    if(method !== 'POST') return server.call(method, url, body);
    envelopes.push(JSON.parse(body));
    const text = server.call(method, url, body);
    if(loseResponse){
      loseResponse = false;
      assert.equal(JSON.parse(text).outcome, 'APPLIED');
      await B.engine.seedBaseline('ticket', TICKET.id, server.state('ticket', TICKET.id));
      await B.editTicket(TICKET.id, {content:'Synthetic device B after device A'});
      throw new Error('Synthetic lost ACK after commit and another device update');
    }
    return text;
  });
  A.setOnline(true);
  await A.editTicket(TICKET.id, {content:'Synthetic delivered device A edit'});
  assert.equal(server.state('ticket', TICKET.id).revision, 3);
  assert.equal(A.engine.pendingCount(), 1, 'foreign current state alone cannot confirm A');
  assert.equal(A.record('ticket', TICKET.id).committedRevision, 1);
  const serverBeforeReplay = harness.clone(server.ticketSheet.rows);
  const localBeforeReplay = harness.clone(A.ctx.tickets);
  await A.flush();
  assert.equal(A.engine.pendingCount(), 0, 'original APPLIED receipt proves A was delivered');
  assert.equal(A.record('ticket', TICKET.id).committedRevision, 2, 'ACK is for A revision, not B revision');
  assert.equal(A.conflict('ticket', TICKET.id), null);
  assert.equal(envelopes.length, 2);
  assert.equal(envelopes[0].requestId, envelopes[1].requestId);
  assert.equal(envelopes[0].body, envelopes[1].body);
  assert.notEqual(envelopes[0].nonce, envelopes[1].nonce);
  assert.deepEqual(server.ticketSheet.rows, serverBeforeReplay, 'receipt replay does not rewrite newer ticket or money');
  assert.deepEqual(A.ctx.tickets, localBeforeReplay);
  assert.equal(server.ticketIds().length, 1);
});

for(const [entity, action] of [['ticket','addTicket'], ['ticket','updateTicket'],
  ['ticket','deleteTicket'], ['shift','addShift'], ['shift','updateShift'], ['shift','deleteShift']]){
  test('verification requires exact delivery proof for '+action, async(t)=>{
    const mutation = {entity, id:'synthetic-proof-'+action, action, revision:2,
      requestId:'synthetic-request-'+action, body:{action, id:'synthetic-proof-'+action, revision:2}};
    const fingerprint = await transport.semanticFingerprint(mutation);
    const cases = [
      ['exact own state', {revision:2, fingerprint}, true],
      ['same revision foreign state', {revision:2, fingerprint:'foreign'}, false, 'CONFLICT'],
      ['newer foreign state', {revision:3, fingerprint:'foreign'}, false],
      ['newer state with copied fingerprint', {revision:3, fingerprint}, false],
      ['newer foreign tombstone', {revision:3, fingerprint:'foreign', tombstone:true}, false],
      ['older state', {revision:1, fingerprint:'older'}, false],
      ['missing state', null, false]
    ];
    for(const [name, state, ok, code] of cases){
      await t.test(name, async()=>{
        const wire = transport.create({url:()=>'/synthetic', secret:()=>harness.HMAC_SECRET,
          random:randomUUID, verifyDelays:[0], fetch:async()=>({ok:true,
            json:async()=>({status:'ok', state})})});
        const result = await wire.verify(mutation);
        assert.equal(result.ok, ok);
        assert.equal(result.result && result.result.code, code);
      });
    }
  });
}

test('verification read failures retain an unknown delivery result', async(t)=>{
  const mutation = {entity:'ticket', id:'synthetic-unreadable', action:'updateTicket',
    revision:2, requestId:'synthetic-request-unreadable', body:{revision:2}};
  for(const [name, fetch] of [
    ['HTTP failure', async()=>({ok:false})],
    ['invalid JSON', async()=>({ok:true, json:async()=>{throw new Error('Synthetic invalid JSON');}})],
    ['network failure', async()=>{throw new Error('Synthetic network failure');}],
    ['read timeout', (_url, options)=>new Promise((_resolve, reject)=>{
      options.signal.addEventListener('abort', ()=>reject(new Error('Synthetic abort')), {once:true});
    })]
  ]){
    await t.test(name, async()=>{
      const wire = transport.create({url:()=>'/synthetic', secret:()=>harness.HMAC_SECRET,
        random:randomUUID, verifyDelays:[0], verifyTimeoutMs:5, fetch});
      assert.deepEqual(await wire.verify(mutation), {ok:false});
    });
  }
});
