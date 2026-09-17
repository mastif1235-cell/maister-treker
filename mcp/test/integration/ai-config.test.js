/* Integration tests: public GET /ai/config (secret-free capability
   descriptor) and CORS for browser clients (/healthz, /ai/config, /ask). */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/index.js';

const ENV = {
  GAS_SYNC_URL: 'https://script.google.com/macros/s/TEST/exec',
  GAS_SYNC_HMAC_SECRET: 'test_hmac_secret_value_at_least_32chars!',
  MCP_BEARER_TOKENS: 'tester:mt_test_token_0123456789abcdef0123456789abcdef:read'
};

function makeApp(env){
  const calls = [];
  const fetchImpl = async function(url, init){
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, data: { list: [] } }), { status: 200 });
  };
  return { app: createApp(env, { fetchImpl }), calls };
}

test('GET /ai/config: secret-free descriptor, ask_configured=false without GROQ key', async () => {
  const { app } = makeApp(ENV);
  const res = await app.fetch(new Request('https://worker.test/ai/config'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'read-only');
  assert.equal(body.auth_required, true);
  assert.equal(body.ask_configured, false);
  assert.equal(body.providers[0].id, 'groq');
  assert.equal(body.providers[0].enabled, false);
  assert.ok(body.providers[0].models[0].capabilities.includes('tools'));
  const text = JSON.stringify(body);
  for(const banned of ['gsk_', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'secret', 'hmac', 'Bearer mt_test', 'mt_test_token', 'api.groq.com']){
    assert.ok(!text.toLowerCase().includes(banned.toLowerCase()), 'no leak: ' + banned);
  }
});

test('GET /ai/config: ask_configured=true when GROQ_API_KEY present; model from env', async () => {
  const { app } = makeApp(Object.assign({}, ENV, { GROQ_API_KEY: 'gsk_test_key_0123456789abcdef0123456789' }));
  const res = await app.fetch(new Request('https://worker.test/ai/config'));
  const body = await res.json();
  assert.equal(body.ask_configured, true);
  assert.equal(body.providers[0].enabled, true);
  assert.equal(body.providers[0].models[0].id, 'openai/gpt-oss-120b');
  const text = JSON.stringify(body);
  assert.ok(!text.includes('gsk_test_key_0123456789abcdef0123456789'), 'the key value itself never appears');
});

test('/ai/config non-GET -> 405 with Allow', async () => {
  const { app } = makeApp(ENV);
  const res = await app.fetch(new Request('https://worker.test/ai/config', { method: 'POST' }));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'GET');
});

test('CORS: /healthz, /ai/config and /ask carry ACAO; OPTIONS preflight 204', async () => {
  const { app } = makeApp(ENV);
  for(const path of ['/healthz', '/ai/config']){
    const res = await app.fetch(new Request('https://worker.test' + path));
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*', path + ' ACAO');
  }
  const pre = await app.fetch(new Request('https://worker.test/ask', { method: 'OPTIONS' }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  const ask = await app.fetch(new Request('https://worker.test/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: 'тест' })
  }));
  assert.equal(ask.status, 401);
  assert.equal(ask.headers.get('Access-Control-Allow-Origin'), '*', '/ask responses carry ACAO');
});

test('/mcp stays CORS-free (native MCP clients unchanged)', async () => {
  const { app } = makeApp(ENV);
  const res = await app.fetch(new Request('https://worker.test/mcp', { method: 'POST', body: 'x' }));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  const pre = await app.fetch(new Request('https://worker.test/mcp', { method: 'OPTIONS' }));
  assert.notEqual(pre.status, 204);
});
