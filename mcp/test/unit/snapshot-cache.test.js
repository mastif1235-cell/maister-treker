/* Unit tests for the KV snapshot provider (stage A). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createSnapshotProvider, snapshotKey, SNAPSHOT_VERSION} from '../../src/data/snapshot.js';

function fakeKv(){
  const map = new Map();
  return {
    map,
    get: async function(key){ return map.has(key) ? map.get(key) : null; },
    put: async function(key, value){ map.set(key, value); }
  };
}

function collector(){
  const jobs = [];
  return {
    jobs,
    waitUntil: function(p){ jobs.push(Promise.resolve(p)); },
    async settle(){ const list = jobs.splice(0); await Promise.all(list.map(function(p){ return p.catch(function(){}); })); }
  };
}

function projection(marker){ return {tickets:[{id:'t-' + marker}], shifts:[]}; }

function gasStub(){
  const state = {calls:0, fail:false};
  return {
    state,
    fetchFn: async function(){
      state.calls++;
      if(state.fail) return {ok:false, code:'NETWORK', message:'AbortError'};
      return {ok:true, data:projection(state.calls)};
    }
  };
}

test('snapshotKey is versioned', () => {
  assert.equal(snapshotKey(), 'mt:snapshot:v' + SNAPSHOT_VERSION);
  assert.equal(SNAPSHOT_VERSION, 2, 'v91.44 redaction/schema change invalidates v1');
  assert.equal(snapshotKey(), 'mt:snapshot:v2');
});

test('v1 envelope is NOT accepted as the current v2 snapshot (v91.44 schema bump)', async () => {
  /* Leftover v1 shape at the current key: treated as a miss, never served. */
  const kv = fakeKv();
  kv.map.set(snapshotKey(), JSON.stringify({v:1, savedAt:Date.now(), data:projection(7)}));
  let calls = 0;
  const provider = createSnapshotProvider({fetchFn:async function(){ calls++; return {ok:true, data:projection(42)}; }, kv, ttlMs:300000, staleMs:86400000});
  const result = await provider.getList();
  assert.equal(calls, 1, 'v1 envelope forces a fresh read instead of serving stale shape');
  assert.deepEqual(result.data, projection(42), 'fresh data served, not the v1 projection');

  /* The old production key mt:snapshot:v1 is neither read nor deleted: the
     new code only ever touches the v2 key. */
  const kv2 = fakeKv();
  kv2.map.set('mt:snapshot:v1', JSON.stringify({v:1, savedAt:1, data:projection(7)}));
  let calls2 = 0;
  const provider2 = createSnapshotProvider({fetchFn:async function(){ calls2++; return {ok:true, data:projection(2)}; }, kv:kv2, ttlMs:300000, staleMs:86400000, waitUntil:function(p){ return Promise.resolve(p).catch(function(){}); }});
  await provider2.getList();
  await new Promise(function(r){ setTimeout(r, 0); });
  assert.equal(calls2, 1, 'v1 key is not used by v2 code (cold miss)');
  assert.equal(kv2.map.get('mt:snapshot:v1'), JSON.stringify({v:1, savedAt:1, data:projection(7)}), 'old v1 KV value left untouched');
  const written = JSON.parse(kv2.map.get('mt:snapshot:v2'));
  assert.equal(written.v, 2, 'new writes go to the v2 envelope');
});

test('cold miss -> GAS -> cache write; fresh hit -> no GAS call', async () => {
  const kv = fakeKv();
  const bg = collector();
  const gas = gasStub();
  let now = 1000000;
  const provider = createSnapshotProvider({fetchFn:gas.fetchFn, kv, ttlMs:300000, staleMs:86400000, now:function(){ return now; }, waitUntil:bg.waitUntil});

  const first = await provider.getList();
  await bg.settle();
  assert.equal(first.ok, true);
  assert.equal(gas.state.calls, 1);
  assert.ok(kv.map.has(snapshotKey()));
  const envelope = JSON.parse(kv.map.get(snapshotKey()));
  assert.equal(envelope.v, SNAPSHOT_VERSION);
  assert.deepEqual(envelope.data, projection(1));

  now += 60000; // 1 min < 5 min TTL
  const second = await provider.getList();
  assert.equal(second.ok, true);
  assert.equal(second.cache, 'fresh');
  assert.deepEqual(second.data, projection(1));
  assert.equal(gas.state.calls, 1); // GAS untouched on fresh hit
});

test('stale -> immediate stale answer + background refresh', async () => {
  const kv = fakeKv();
  const bg = collector();
  const gas = gasStub();
  let now = 2000000;
  const provider = createSnapshotProvider({fetchFn:gas.fetchFn, kv, ttlMs:300000, staleMs:86400000, now:function(){ return now; }, waitUntil:bg.waitUntil});

  await provider.getList();
  await bg.settle();
  now += 300001; // past TTL, inside stale window
  const stale = await provider.getList();
  assert.equal(stale.cache, 'stale');
  assert.deepEqual(stale.data, projection(1)); // answered from cache
  await bg.settle();
  assert.equal(gas.state.calls, 2); // refresh ran in the background
  assert.deepEqual(JSON.parse(kv.map.get(snapshotKey())).data, projection(2));
});

test('GAS failure with cache -> last known good copy served', async () => {
  const kv = fakeKv();
  const bg = collector();
  const gas = gasStub();
  let now = 3000000;
  const provider = createSnapshotProvider({fetchFn:gas.fetchFn, kv, ttlMs:300000, staleMs:86400000, now:function(){ return now; }, waitUntil:bg.waitUntil});

  await provider.getList();
  await bg.settle();
  now += 10 * 86400000; // very old, beyond staleMs
  gas.state.fail = true;
  const result = await provider.getList();
  assert.equal(result.ok, true);
  assert.equal(result.cache, 'stale');
  assert.deepEqual(result.data, projection(1));
});

test('GAS failure without cache -> controlled error passthrough', async () => {
  const bg = collector();
  const gas = gasStub();
  gas.state.fail = true;
  const provider = createSnapshotProvider({fetchFn:gas.fetchFn, kv:fakeKv(), ttlMs:300000, staleMs:86400000, waitUntil:bg.waitUntil});
  const result = await provider.getList();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NETWORK');
});

test('KV absent -> transparent passthrough, every call fetches', async () => {
  const bg = collector();
  const gas = gasStub();
  const provider = createSnapshotProvider({fetchFn:gas.fetchFn, kv:null, ttlMs:300000, staleMs:86400000, waitUntil:bg.waitUntil});
  await provider.getList();
  const second = await provider.getList();
  assert.equal(second.ok, true);
  assert.equal(gas.state.calls, 2);
});

test('corrupted or wrong-version cache value is treated as a miss', async () => {
  const kv = fakeKv();
  kv.map.set(snapshotKey(), '{not json');
  const gas = gasStub();
  const provider = createSnapshotProvider({fetchFn:gas.fetchFn, kv, ttlMs:300000, staleMs:86400000});
  const result = await provider.getList();
  assert.equal(result.ok, true);
  assert.equal(gas.state.calls, 1);

  const kv2 = fakeKv();
  kv2.map.set(snapshotKey(), JSON.stringify({v:999, savedAt:1, data:projection(9)}));
  const gas2 = gasStub();
  const provider2 = createSnapshotProvider({fetchFn:gas2.fetchFn, kv:kv2, ttlMs:300000, staleMs:86400000});
  await provider2.getList();
  assert.equal(gas2.state.calls, 1); // wrong version ignored

  const kv3 = fakeKv();
  kv3.map.set(snapshotKey(), JSON.stringify({v:SNAPSHOT_VERSION, savedAt:Date.now(), data:{tickets:'nope', shifts:null}}));
  const gas3 = gasStub();
  const provider3 = createSnapshotProvider({fetchFn:gas3.fetchFn, kv:kv3, ttlMs:300000, staleMs:86400000});
  await provider3.getList();
  assert.equal(gas3.state.calls, 1); // wrong shape ignored
});

test('KV write failure is swallowed and never breaks the answer', async () => {
  const bg = collector();
  const gas = gasStub();
  const brokenKv = {get: async function(){ return null; }, put: async function(){ throw new Error('KV_PUT_FAILED'); }};
  const provider = createSnapshotProvider({fetchFn:gas.fetchFn, kv:brokenKv, ttlMs:300000, staleMs:86400000, waitUntil:bg.waitUntil});
  const result = await provider.getList();
  assert.equal(result.ok, true);
  await bg.settle();
});

test('KV read failure is treated as a miss (fail open to GAS)', async () => {
  const gas = gasStub();
  const brokenKv = {get: async function(){ throw new Error('KV_GET_FAILED'); }, put: async function(){}};
  const provider = createSnapshotProvider({fetchFn:gas.fetchFn, kv:brokenKv, ttlMs:300000, staleMs:86400000});
  const result = await provider.getList();
  assert.equal(result.ok, true);
  assert.equal(gas.state.calls, 1);
});

test('refresh() fetches and writes (cron path)', async () => {
  const kv = fakeKv();
  const gas = gasStub();
  const provider = createSnapshotProvider({fetchFn:gas.fetchFn, kv, ttlMs:300000, staleMs:86400000});
  const ok = await provider.refresh();
  assert.equal(ok, true);
  assert.equal(gas.state.calls, 1);
  assert.ok(kv.map.has(snapshotKey()));
  gas.state.fail = true;
  assert.equal(await provider.refresh(), false); // old snapshot preserved
  assert.deepEqual(JSON.parse(kv.map.get(snapshotKey())).data, projection(1));
});
