/* Unit tests for environment parsing (fail-closed behavior). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {loadConfig} from '../../src/config.js';

const TOKEN = 'mt_test_cli_0123456789abcdef0123456789abcdef';

function env(overrides){
  return Object.assign({
    GAS_SYNC_URL: 'https://script.google.com/macros/s/TEST/exec',
    GAS_SYNC_HMAC_SECRET: '0123456789abcdef0123456789abcdef',
    MCP_BEARER_TOKENS: 'cli:' + TOKEN + ':read'
  }, overrides || {});
}

test('valid env produces full config with defaults', async () => {
  const loaded = await loadConfig(env());
  assert.equal(loaded.ok, true);
  assert.equal(loaded.config.rateLimitPerMin, 120);
  assert.equal(loaded.config.listCacheTtlMs, 15000);
  assert.equal(loaded.config.gasTimeoutMs, 8000);
  assert.equal(loaded.config.tokens.length, 1);
  assert.equal(loaded.config.tokens[0].raw, ''); // raw token dropped after hashing
});

test('missing or insecure pieces reject the whole config', async () => {
  assert.equal((await loadConfig(env({GAS_SYNC_URL: ''}))).ok, false);
  assert.equal((await loadConfig(env({GAS_SYNC_URL: 'http://insecure.example/mcp'}))).ok, false);
  assert.equal((await loadConfig(env({GAS_SYNC_HMAC_SECRET: 'short'}))).ok, false);
  assert.equal((await loadConfig(env({MCP_BEARER_TOKENS: 'garbage'}))).ok, false);
  assert.equal((await loadConfig(env({MCP_BEARER_TOKENS: ''}))).ok, false);
  const missing = await loadConfig({});
  assert.equal(missing.ok, false);
  assert.equal(typeof missing.reason, 'string');
});

test('numeric overrides are clamped into sane ranges', async () => {
  const loaded = await loadConfig(env({MCP_RATE_LIMIT_PER_MIN: '-5', MCP_LIST_CACHE_TTL_MS: '99999999', MCP_GAS_TIMEOUT_MS: '0'}));
  assert.equal(loaded.ok, true);
  assert.equal(loaded.config.rateLimitPerMin, 1);
  assert.equal(loaded.config.listCacheTtlMs, 300000);
  assert.equal(loaded.config.gasTimeoutMs, 1000);
});

test('config rejection reasons never contain secret values', async () => {
  const result = await loadConfig(env({MCP_BEARER_TOKENS: 'cli:' + TOKEN + ':write'}));
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});
