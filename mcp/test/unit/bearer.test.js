/* Unit tests for bearer token config and constant-time authentication. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {parseBearerTokens, prepareTokens, authenticate} from '../../src/auth/bearer.js';

const TOKEN_A = 'mt_test_cli_0123456789abcdef0123456789abcdef';
const TOKEN_B = 'mt_second_client_0123456789abcdef012345678';

test('parseBearerTokens accepts semicolon/newline separated name:token:scope entries', () => {
  const tokens = parseBearerTokens('cli-a:' + TOKEN_A + ':read\ncli-b:' + TOKEN_B + ':read;');
  assert.equal(tokens.length, 2);
  assert.deepEqual(tokens.map(function(t){ return t.name; }), ['cli-a', 'cli-b']);
  assert.deepEqual(tokens.map(function(t){ return t.scope; }), ['read', 'read']);
});

test('parseBearerTokens rejects invalid configurations (fail closed)', () => {
  assert.throws(function(){ parseBearerTokens(''); }, /at least one token/);
  assert.throws(function(){ parseBearerTokens('cli-a:short:read'); }, /32\.\.128/);
  assert.throws(function(){ parseBearerTokens('cli-a:' + TOKEN_A + ':write'); }, /only scope "read"/);
  assert.throws(function(){ parseBearerTokens('Cli_A:' + TOKEN_A + ':read'); }, /bad client name/);
  assert.throws(function(){ parseBearerTokens('cli-a:' + TOKEN_A + ':read;cli-a:' + TOKEN_B + ':read'); }, /duplicate/);
  assert.throws(function(){ parseBearerTokens('cli-a-' + TOKEN_A); }, /name:token:scope/);
});

test('authenticate accepts a valid token and identifies the client', async () => {
  const tokens = await prepareTokens(parseBearerTokens('cli-a:' + TOKEN_A + ':read;cli-b:' + TOKEN_B + ':read'));
  const ok = await authenticate('Bearer ' + TOKEN_A, tokens);
  assert.deepEqual(ok, {ok:true, client:{name:'cli-a', scope:'read'}});
  const okB = await authenticate('bearer ' + TOKEN_B, tokens); // case-insensitive scheme
  assert.equal(okB.ok, true);
  assert.equal(okB.client.name, 'cli-b');
});

test('authenticate rejects missing/malformed/unknown tokens', async () => {
  const tokens = await prepareTokens(parseBearerTokens('cli-a:' + TOKEN_A + ':read'));
  assert.deepEqual(await authenticate(null, tokens), {ok:false, reason:'missing'});
  assert.equal((await authenticate('', tokens)).ok, false);
  assert.equal((await authenticate('Basic abc', tokens)).ok, false);
  assert.equal((await authenticate('Bearer ' + TOKEN_B, tokens)).ok, false);
  assert.equal((await authenticate('Bearer ', tokens)).ok, false);
});
