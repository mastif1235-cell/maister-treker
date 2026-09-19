/* Integration tests for the KV snapshot cache (stage A) through the full
   Worker: /mcp reads hit KV, the cached value is the redacted projection,
   and the Cron Trigger (scheduled handler) keeps the snapshot warm. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createApp} from '../../src/index.js';
import {scheduledHandler} from '../../src/index.js';
import {FIXTURES} from '../fixtures/data.js';
import {snapshotKey, SNAPSHOT_VERSION} from '../../src/data/snapshot.js';
import {makeApp, mockGasFetch, toolCall, toolData} from '../helpers/mcpapp.js';

function fakeKv(){
  const map = new Map();
  return {map,
    get: async function(key){ return map.has(key) ? map.get(key) : null; },
    put: async function(key, value){ map.set(key, value); }
  };
}

async function awaitBackground(app){
  // flush the isolate-level background promises collected by the provider
  await new Promise(function(resolve){ setImmediate(resolve); });
  void app;
}

test('two /mcp list calls hit GAS once when KV is bound; cached value is redacted', async () => {
  const kv = fakeKv();
  const fetchImpl = mockGasFetch('ok');
  const env = testEnvFor(kv);
  const app = await makeApp(env, fetchImpl);
  const first = toolData((await toolCall(app, 'list_tickets', {})).result);
  const second = toolData((await toolCall(app, 'list_tickets', {})).result);
  assert.equal(first.tickets.length, 5);
  assert.equal(second.tickets.length, 5);
  const listCalls = fetchImpl.calls.filter(function(call){ return call.action === 'list'; }).length;
  assert.equal(listCalls, 1); // second call served from KV

  const stored = JSON.parse(kv.map.get(snapshotKey()));
  assert.equal(stored.v, SNAPSHOT_VERSION); // v2 since the v91.44 redaction/schema change
  const serialized = JSON.stringify(stored.data);
  assert.ok(!serialized.includes('fullDataJson'));
  assert.ok(!serialized.includes('backupNote'));
  assert.ok(!serialized.includes('"password"'));
  assert.ok(!serialized.includes('tgPhotoFileIds'));
  assert.ok(stored.data.tickets[0].clientName !== undefined); // whitelisted fields present
});

test('get_ticket stays a fresh single-row GAS read (bypasses snapshot cache)', async () => {
  const kv = fakeKv();
  const fetchImpl = mockGasFetch('ok');
  const env = testEnvFor(kv);
  const app = await makeApp(env, fetchImpl);
  await toolCall(app, 'list_tickets', {}); // warms the snapshot
  const before = fetchImpl.calls.length;
  const one = toolData((await toolCall(app, 'get_ticket', {ticket_id:'t-001'})).result);
  assert.equal(one.found, true);
  assert.equal(one.ticket.id, 't-001');
  assert.ok(fetchImpl.calls.length > before); // getTicketById always goes to GAS
});

function testEnvFor(kv){
  return {
    GAS_SYNC_URL: 'https://script.google.com/macros/s/TESTDEPLOY/exec',
    GAS_SYNC_HMAC_SECRET: '0123456789abcdef0123456789abcdef',
    MCP_BEARER_TOKENS: 'test-cli:mt_test_cli_0123456789abcdef0123456789abcdef:read',
    MT_SNAPSHOT_KV: kv
  };
}

test('Cron Trigger (scheduled) warms the KV snapshot; subsequent reads skip GAS', async () => {
  const kv = fakeKv();
  const fetchImpl = mockGasFetch('ok');
  const env = testEnvFor(kv);
  const waited = [];
  const ctxLike = {waitUntil: function(p){ waited.push(Promise.resolve(p)); }};

  await scheduledHandler({}, env, ctxLike, {fetchImpl});
  await Promise.all(waited.map(function(p){ return p.catch(function(){}); }));

  assert.ok(kv.map.has(snapshotKey()));
  const listCalls = fetchImpl.calls.filter(function(call){ return call.action === 'list'; }).length;
  assert.equal(listCalls, 1);

  // a fresh app instance over the same env + mock (same KV namespace):
  // the warm snapshot must serve the read with zero additional GAS calls
  const freshApp = createApp(env, {fetchImpl});
  await freshApp.appPromise;
  const result = toolData((await toolCall(freshApp, 'list_tickets', {})).result);
  assert.equal(result.tickets.length, 5);
  const listCallsAfter = fetchImpl.calls.filter(function(call){ return call.action === 'list'; }).length;
  assert.equal(listCallsAfter, 1); // served by the warm snapshot
});

test('scheduled handler survives GAS failure and keeps the old snapshot', async () => {
  const kv = fakeKv();
  const fetchImpl = mockGasFetch('ok');
  const env = testEnvFor(kv);
  await scheduledHandler({}, env, {waitUntil:function(){}}, {fetchImpl});
  const good = kv.map.get(snapshotKey());

  const failing = mockGasFetch('network');
  const env2 = testEnvFor(kv);
  const app2 = createApp(env2, {fetchImpl: failing});
  const loaded2 = await app2.appPromise;
  const ok = await loaded2.provider.refresh();
  assert.equal(ok, false);
  assert.equal(kv.map.get(snapshotKey()), good); // last known good preserved
});
