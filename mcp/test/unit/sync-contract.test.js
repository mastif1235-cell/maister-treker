/* Contract parity: the Worker-side canonical HMAC must be byte-identical to
   the app's js/sync-contract.js and to the shared repo fixtures. */

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';

import * as workerContract from '../../src/gas/sync-contract.js';
import {REPO_ROOT, loadAppModule} from '../helpers/appvm.js';

const vectors = JSON.parse(readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', 'sync-contract-v3-vectors.json'), 'utf8'));
const app = loadAppModule('js/sync-contract.js').MasterTrackerSyncContract;

test('canonical form is byte-identical to the app module', () => {
  const request = {v:3, method:'get', action:'getTicketById', entity:'ticket', id:'t-1', ts:'1760000000000', nonce:'abcdefghijklmnopQRSTUVWX', requestId:'', body:''};
  assert.equal(workerContract.canonical(request), app.canonical(request));
});

test('canonical form handles UTF-8 length-prefixing identically (incl. multiline body)', () => {
  const body = JSON.stringify({action:'x', note:'ремонт оптики\nдругий рядок 🙂', sum:100});
  const request = {v:3, method:'POST', action:'x', entity:'ticket', id:'t-1', ts:'1760000000000', nonce:'ZYXWVUTSrqponmlk98765432', requestId:'req-1', body};
  assert.equal(workerContract.canonical(request), app.canonical(request));
  assert.ok(workerContract.canonical(request).startsWith(workerContract.PREFIX));
  const bodyBytes = new TextEncoder().encode(body).length;
  assert.ok(workerContract.canonical(request).includes(bodyBytes + ':' + body)); // length-prefix matches UTF-8 byte count
});

test('worker signatures match every shared fixture vector', async () => {
  for(const vector of vectors.vectors){
    const signature = await workerContract.sign(vector.request, vectors.secret);
    assert.equal(signature, vector.signature, 'vector: ' + vector.name);
  }
});

test('worker and app produce identical signatures for the same request', async () => {
  const request = {v:3, method:'GET', action:'getTicketById', entity:'ticket', id:'abc-123', ts:'1760000000000', nonce:'abcdefghijklmnopQRSTUVWX', requestId:'', body:''};
  assert.equal(await workerContract.sign(request, vectors.secret), await app.sign(request, vectors.secret));
});

test('secret shorter than 32 bytes is rejected (fail closed)', async () => {
  await assert.rejects(function(){ return workerContract.sign({v:3, method:'GET', action:'list', entity:'system', id:'', ts:'1760000000000', nonce:'abcdefghijklmnop', requestId:'', body:''}, 'short-secret'); }, /HMAC_SECRET_TOO_SHORT/);
});
