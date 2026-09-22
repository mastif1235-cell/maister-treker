'use strict';
/* Regression test: «server/Sheets already accepted the mutation, but the local
   client never received/persisted the ACK → Retry must converge safely».

   Live phone report (v91.61, post-PR-#45): an ordinary edit of an existing
   ticket reached Google Sheets, yet the PWA kept showing
   «⏳ Не синхронізовано: 1», the card badge stayed «⏳ Таблиця» (no
   ⚠️ Конфлікт), and neither three manual retries nor a full app restart
   cleared it. Reproduced here with the REAL Code.gs + REAL browser sync
   stack (tests/helpers/sync-gas-harness.js) — nothing touches production.

   Root cause: every retry just re-POSTs into the same congested pipe; the
   read path is used only inside the narrow verify window right after a failed
   POST. Fix (this test pins it): before re-POSTing an attempted head the
   engine runs a strict read probe (same revision + same semantic fingerprint
   → applied; same revision + different fingerprint → conflict; anything else
   → normal POST path). The PR-#45 STALE protection is asserted unchanged. */

const assert = require('node:assert/strict');
const path = require('node:path');
const harness = require('./helpers/sync-gas-harness.js');
const transportModule = require('../js/sync-transport.js');

const TICKET = { id:'t1', date:'21.09.2026', time:'13:52', content:'Початковий текст', sum:100, type:'Ремонт' };
const EDIT = 'Ремонт — оновлений текст';

/* Transport seam that models a congested GAS pipe:
   - 'blackhole': the FIRST send really reaches the server (it applies the
     mutation) but the response is lost (POST timeout after commit + failed
     verify window); later sends produce nothing client-side.
   - 'post-dead': every transport.send answers generic NETWORK failure (POST
     pipe stuck), while GETs issued outside transport.send stay healthy —
     exactly the LockService-queue shape where a read probe can get through.
   - 'healthy': pass-through (idempotent replay, STALE/CONFLICT outcomes). */
function installSendWrapper(device){
  const inner = device.transport.send;
  const state = { mode:'healthy', calls:0, serverPosts:0, probes:0, probeDead:false };
  device.transport.send = async mutation => {
    state.calls++;
    if (state.mode === 'healthy') return inner(mutation);
    if (state.mode === 'blackhole'){
      if (state.calls === 1){
        state.serverPosts++;
        const result = await inner(mutation);
        if (!result.ok) return result;
        return { ok:false, result:{ status:'error', code:'NETWORK' } };
      }
      return { ok:false, result:{ status:'error', code:'NETWORK' } };
    }
    return { ok:false, result:{ status:'error', code:'NETWORK' } };
  };
  if (typeof device.transport.verifyStrict === 'function'){
    const strict = device.transport.verifyStrict.bind(device.transport);
    device.transport.verifyStrict = async mutation => {
      state.probes++;
      if (state.probeDead) return { status:'unknown' };
      return strict(mutation);
    };
  }
  return state;
}

async function seedSyncedTicket(server){
  const device = await harness.createDevice({ server, name:'seed' });
  await device.addTicket(TICKET);
  assert.equal(server.state('ticket','t1').revision, 1, 'seed: server at r1');
  return { journal: device.journal(), tickets: harness.clone(device.ctx.tickets) };
}

async function reload(server, journal, tickets, name){
  const device = await harness.createDevice({ server, name, journal: harness.clone(journal), tickets: harness.clone(tickets), online:false });
  const mode = installSendWrapper(device);
  device.setOnline(true);
  return { device, mode };
}

(async () => {

  /* 1. The live phone symptom: Sheets updated, client stays ⏳ pending, no
        conflict, retries + restart do not clear it, data never lost. */
  {
    const server = harness.createServer();
    const seed = await seedSyncedTicket(server);
    const { device, mode } = await reload(server, seed.journal, seed.tickets, 'lost-ack');
    mode.mode = 'blackhole';
    mode.probeDead = true; // читаются только попытки flush — сеть мертва целиком
    await device.editTicket('t1', { content: EDIT });

    assert.equal(server.ticketRow('t1').content, EDIT, 'Sheets already has the edit (server applied it)');
    assert.equal(server.state('ticket','t1').revision, 2, 'server revision 2');
    assert.equal(server.ticketIds().length, 1, 'no duplicate rows');
    assert.equal(device.engine.pendingCount(), 1, 'banner counts 1 unsynced');
    assert.equal(device.conflict('ticket','t1'), null, 'no conflict badge (⏳ Таблиця, not ⚠️)');
    assert.equal(device.isSynced('ticket','t1'), false, 'card badge ⏳ Таблиця');
    assert.equal(device.record('ticket','t1').committedRevision, 1, 'ack not recorded locally');
    const expectedFp = await transportModule.semanticFingerprint(device.record('ticket','t1').head);
    assert.equal(server.state('ticket','t1').fingerprint, expectedFp, 'server state IS this mutation (semantic fingerprint)');

    for (let i = 0; i < 3; i++) await device.flush(); // «Повторити» ×3, сеть ещё плохая
    const { device: restarted, mode: mode2 } = await reload(server, device.journal(), harness.clone(device.ctx.tickets), 'lost-ack-restart');
    mode2.mode = 'blackhole';
    mode2.probeDead = true;
    await restarted.flush();

    assert.equal(restarted.engine.pendingCount(), 1, 'pending survives Retry ×3 + restart while no response arrives');
    assert.equal(restarted.conflict('ticket','t1'), null, 'no false conflict after restart');
    assert.equal(server.ticketRow('t1').content, EDIT, 'change is safe in Sheets the whole time');
    assert.equal(server.ticketIds().length, 1, 'still exactly one row (idempotent retries never duplicate)');

    /* 2. As soon as ANY response arrives again, one flush converges. */
    mode2.mode = 'healthy';
    mode2.probeDead = false;
    await restarted.flush();
    assert.equal(restarted.engine.pendingCount(), 0, 'pending cleared once a response arrives');
    assert.equal(restarted.isSynced('ticket','t1'), true, 'badge ✅ Таблиця');
    assert.equal(restarted.record('ticket','t1').committedRevision, 2, 'committedRevision == server revision');
    assert.equal(restarted.conflict('ticket','t1'), null, 'no conflict on convergence');
    assert.equal(server.ticketRow('t1').content, EDIT, 'Sheets content unchanged by convergence');
    assert.equal(server.ticketIds().length, 1, 'no duplicate after convergence');
    console.log('PASS lost response: symptom reproduced, data safe, converges when a response arrives');
  }

  /* 3. THE FIX: read probe before re-POST heals a stuck attempted head even
        while the POST pipe stays dead (no new POST, no duplicate, no conflict). */
  {
    const server = harness.createServer();
    const seed = await seedSyncedTicket(server);
    const { device, mode } = await reload(server, seed.journal, seed.tickets, 'probe');
    mode.mode = 'blackhole';
    await device.editTicket('t1', { content: EDIT });
    assert.equal(server.ticketRow('t1').content, EDIT, 'server has the edit');

    const { device: retried, mode: mode2 } = await reload(server, device.journal(), harness.clone(device.ctx.tickets), 'probe-retry');
    mode2.mode = 'post-dead';
    const postsBefore = mode2.calls;
    await retried.flush();

    assert.equal(typeof retried.transport.verifyStrict, 'function', 'transport exposes the strict read probe');
    assert.equal(retried.engine.pendingCount(), 0, 'probe acks the already-applied mutation (pending cleared)');
    assert.equal(retried.record('ticket','t1').committedRevision, 2, 'committedRevision == applied revision');
    assert.equal(retried.conflict('ticket','t1'), null, 'probe never invents a conflict for our own write');
    assert.equal(retried.isSynced('ticket','t1'), true, 'badge ✅ Таблиця without any POST');
    assert.equal(mode2.calls, postsBefore, 'healed without another POST attempt (read-only)');
    assert.equal(server.ticketRow('t1').content, EDIT, 'Sheets untouched by the probe');
    assert.equal(server.ticketIds().length, 1, 'no duplicate write');
    console.log('PASS read probe heals lost-ACK pending while POST pipe stays dead');
  }

  /* 4. Fresh heads are never probed — the ordinary path is untouched. */
  {
    const server = harness.createServer();
    const device = await harness.createDevice({ server, name:'fresh' });
    let probeCalls = 0;
    const strict = device.transport.verifyStrict.bind(device.transport);
    device.transport.verifyStrict = async mutation => { probeCalls++; return strict(mutation); };
    await device.addTicket(TICKET);
    await device.editTicket('t1', { content: EDIT });
    assert.equal(probeCalls, 0, 'first-attempt heads go straight to POST (no probe)');
    assert.equal(device.engine.pendingCount(), 0, 'ordinary sync still converges');
    console.log('PASS fresh heads skip the probe (ordinary path unchanged)');
  }

  /* 5. PR-#45 STALE protection intact: probe cannot ack a head the server
        never applied, and a real STALE still parks a conflict. */
  {
    const server = harness.createServer();
    const seed = await seedSyncedTicket(server);
    const B = await harness.createDevice({ server, name:'B', tickets: seed.tickets, journal: seed.journal });
    await B.editTicket('t1', { content:'Пристрій B: правка 1' });
    await B.editTicket('t1', { content:'Пристрій B: правка 2' });
    assert.equal(server.state('ticket','t1').revision, 3, 'server moved to r3 by device B');

    const A = await harness.createDevice({ server, name:'A', tickets: seed.tickets, journal: harness.clone(seed.journal), online:false });
    const modeA = installSendWrapper(A);
    A.ctx.tickets = harness.clone(seed.tickets);
    A.ctx.syncTicketsSnapshot = harness.clone(seed.tickets);
    A.setOnline(true);
    modeA.mode = 'post-dead';
    await A.editTicket('t1', { content: EDIT });
    modeA.mode = 'healthy';
    await A.flush();

    assert.ok(A.conflict('ticket','t1'), 'genuine STALE still parks a ⚠️ Конфлікт (not acked)');
    assert.equal(A.engine.pendingCount(), 1, 'head stays parked for the user decision');
    assert.equal(A.isSynced('ticket','t1'), false, 'never marked synced while unapplied');
    assert.equal(server.ticketRow('t1').content, 'Пристрій B: правка 2', 'server content untouched');
    console.log('PASS genuine STALE keeps the PR-#45 conflict protection');
  }

  /* 6. Same-revision collision (another writer, different content): the probe
        answers "conflict" — never a false ack of someone else's write. */
  {
    const server = harness.createServer();
    const seed = await seedSyncedTicket(server);
    const B = await harness.createDevice({ server, name:'B', tickets: seed.tickets, journal: seed.journal });
    await B.editTicket('t1', { content:'Пристрій B: інша правка (r2)' });
    assert.equal(server.state('ticket','t1').revision, 2, 'server r2 by device B');

    const A = await harness.createDevice({ server, name:'A', tickets: seed.tickets, journal: harness.clone(seed.journal), online:false });
    const modeA = installSendWrapper(A);
    A.ctx.tickets = harness.clone(seed.tickets);
    A.ctx.syncTicketsSnapshot = harness.clone(seed.tickets);
    A.setOnline(true);
    modeA.mode = 'post-dead';
    await A.editTicket('t1', { content: EDIT });
    const postsBefore = modeA.calls;
    modeA.mode = 'post-dead';
    const sendLogBefore = A.sendLog.length;
    await A.flush();

    assert.ok(A.conflict('ticket','t1'), 'same revision + different fingerprint → ⚠️ Конфлікт');
    assert.equal(A.isSynced('ticket','t1'), false, 'foreign write never acknowledged as ours');
    assert.equal(A.sendLog.length, sendLogBefore, 'resolved by the probe before any POST');
    assert.equal(modeA.calls, postsBefore, 'no new POST was needed');
    assert.equal(server.ticketRow('t1').content, 'Пристрій B: інша правка (r2)', 'B content intact');
    console.log('PASS same-revision collision becomes a conflict, never a false ack');
  }

  /* 7. Engines whose transport has no verifyStrict keep the exact old
        behaviour (guard for test doubles and future transports). */
  {
    const { Engine } = require('../js/sync-engine-runtime.js');
    const storageDb = { value:{records:{}}, load:async () => JSON.parse(JSON.stringify(storageDb.value)), save:async next => { storageDb.value = JSON.parse(JSON.stringify(next)); } };
    let sends = 0, ok = false;
    const engine = new Engine({
      core: require('../js/sync-engine-core.js'),
      storage: storageDb,
      payload: (_entity, item) => item,
      online: () => true,
      transport: { send: async mutation => { sends++; return ok ? { ok:true, state:{ revision:mutation.revision, tombstone:false } } : { ok:false, result:{ status:'error', code:'NETWORK' } }; } }
    });
    await engine.init();
    await engine.recordDiff('ticket', [], [{ id:'t9', date:'21.09.2026', time:'13:52', content:'x', sum:1, tags:[] }]);
    await engine.flush();
    assert.equal(sends, 1, 'first attempt went out');
    ok = true;
    await engine.flush();
    assert.equal(sends, 2, 'without verifyStrict the engine simply re-POSTs (old behaviour)');
    assert.equal(engine.pendingCount(), 0, 'and still converges');
    console.log('PASS transports without verifyStrict keep the old re-POST behaviour');
  }

  /* 8. Transport-level verifyStrict semantics. */
  {
    const secret = '0123456789abcdef0123456789abcdef';
    let nonce = 0;
    const random = () => `nonce_${++nonce}_abcdefghijklmnop`;
    const mutation = { entity:'ticket', id:'t1', action:'updateTicket', revision:2, requestId:'mt.request_abcdefghijkl',
      body:{ action:'updateTicket', id:'t1', revision:2, date:'21.09.2026', time:'13:52', content:EDIT, sum:1, tags:[] } };
    const fingerprint = await transportModule.semanticFingerprint(mutation);
    const make = fetchImpl => transportModule.create({ url:() => '/gas', secret:() => secret, random, now:() => 1787472000000, verifyDelays:[0], fetch:fetchImpl });

    const applied = await make(async () => ({ ok:true, json:async () => ({ status:'ok', state:{ revision:2, tombstone:false, fingerprint } }) })).verifyStrict(mutation);
    assert.deepEqual({ status:applied.status, revision:applied.state && applied.state.revision }, { status:'applied', revision:2 }, 'exact match → applied');

    const conflict = await make(async () => ({ ok:true, json:async () => ({ status:'ok', state:{ revision:2, tombstone:false, fingerprint:'different' } }) })).verifyStrict(mutation);
    assert.equal(conflict.status, 'conflict', 'same revision, different content → conflict');

    const ahead = await make(async () => ({ ok:true, json:async () => ({ status:'ok', state:{ revision:5, tombstone:false, fingerprint:'whatever' } }) })).verifyStrict(mutation);
    assert.equal(ahead.status, 'unknown', 'different revision → unknown (POST path decides)');

    const behind = await make(async () => ({ ok:true, json:async () => ({ status:'ok', state:{ revision:1, tombstone:false, fingerprint } }) })).verifyStrict(mutation);
    assert.equal(behind.status, 'unknown', 'server behind the head → unknown');

    const httpError = await make(async () => ({ ok:false, status:500, json:async () => ({ status:'error' }) })).verifyStrict(mutation);
    assert.equal(httpError.status, 'unknown', 'HTTP failure → unknown');

    const network = await make(async () => { throw new Error('timeout'); }).verifyStrict(mutation);
    assert.equal(network.status, 'unknown', 'network failure → unknown (never throws)');
    console.log('PASS verifyStrict: applied / conflict / unknown semantics');
  }

  console.log('PASS sync-lost-ack-retry: all scenarios green');
})().catch(error => { console.error(error); process.exitCode = 1; });
