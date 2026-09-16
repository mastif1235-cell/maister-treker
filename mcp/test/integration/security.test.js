/* Security negative tests: secrets/tg fields/passwords must never reach any
   MCP output even when the upstream payload is adversarial; auth must fail
   closed; the data endpoint must leak nothing on non-2xx paths. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {makeApp, mockGasFetch, post, rpc, toolCall, BEARER_TOKEN, testEnv} from '../helpers/mcpapp.js';
import {FIXTURES} from '../fixtures/data.js';
import {REDACTED_TICKET_FIELDS, assertNoForbidden, isForbiddenKey} from '../../src/gas/mappers.js';

const HMAC_SECRET = '0123456789abcdef0123456789abcdef';
const GAS_URL = 'https://script.google.com/macros/s/TESTDEPLOY/exec';

const FORBIDDEN_VALUES = [
  FIXTURES.SECRET_VALUES.password,
  FIXTURES.SECRET_VALUES.login,
  FIXTURES.SECRET_VALUES.masterNote,
  FIXTURES.SECRET_VALUES.tgPhotoFileId,
  FIXTURES.SECRET_VALUES.tgJsonMsgId,
  'Пароль:',
  'Логін:',
  'Приватна примітка майстра:',
  '@local-only',
  'backupNote',
  'fullDataJson',
  'tgPhotoFileIds',
  'tgBackedUp',
  'syncHmacSecret',
  'tgBotToken',
  HMAC_SECRET,
  GAS_URL,
  'injected-bot-token-0123456789',
  'injected-hmac-secret-0123456789',
  'row-level-bot-token-0123456789',
  'row-level-hmac-secret-0123456789'
];

async function collectAllOutputs(fetchImpl){
  const app = await makeApp(null, fetchImpl);
  const calls = [
    ['list_tickets', {}],
    ['get_ticket', {ticket_id:'t-900'}],
    ['search_tickets', {query:'SECRET'}],
    ['search_tickets', {query:'0'}],
    ['get_tickets_by_date', {date:'17.09.2026'}],
    ['get_shifts', {}],
    ['get_reports', {date_from:'01.08.2026', date_to:'17.09.2026'}],
    ['get_statistics', {period:'all'}]
  ];
  const outputs = [];
  for(const [name, args] of calls){
    const call = await toolCall(app, name, args);
    outputs.push({tool:name, text:call.text || ''});
  }
  return outputs;
}

test('adversarial upstream payload: no secret value appears in ANY tool output', async () => {
  const outputs = await collectAllOutputs(mockGasFetch('ok', FIXTURES.adversarialListPayload));
  assert.ok(outputs.length === 8);
  for(const output of outputs){
    for(const forbidden of FORBIDDEN_VALUES){
      assert.ok(!output.text.includes(forbidden), output.tool + ' leaked: ' + forbidden);
    }
  }
});

test('every redacted ticket in output has exactly the whitelisted key set', async () => {
  const app = await makeApp(null, mockGasFetch('ok', FIXTURES.adversarialListPayload));
  const call = await toolCall(app, 'list_tickets', {limit:200});
  const data = JSON.parse(call.text);
  assert.equal(data.tickets.length, 6);
  for(const ticket of data.tickets){
    assert.deepEqual(Object.keys(ticket).sort(), REDACTED_TICKET_FIELDS.slice().sort());
    assert.doesNotThrow(function(){ assertNoForbidden(ticket); });
  }
});

test('output objects never contain forbidden keys (recursive walk, adversarial data)', async () => {
  const app = await makeApp(null, mockGasFetch('ok', FIXTURES.adversarialListPayload));
  for(const [name, args] of [
    ['list_tickets', {limit:200}],
    ['get_ticket', {ticket_id:'t-900'}],
    ['get_reports', {date_from:'01.08.2026', date_to:'17.09.2026'}],
    ['get_statistics', {period:'all'}],
    ['get_shifts', {}]
  ]){
    const call = await toolCall(app, name, args);
    const data = JSON.parse(call.text);
    assert.doesNotThrow(function(){ assertNoForbidden(data); }, name);
  }
});

test('isForbiddenKey blocks the exact field classes from the threat model', () => {
  const forbidden = ['password','Password','tgPhotoFileId','tgPhotoFileIds','tgBackedUp','tgJsonMsgId',
    'syncHmacSecret','tgBotToken','apiToken','accessToken','refreshToken','mapTilerKey','scriptUrl',
    'backupNote','fullDataJson','login','masterNote','clientSecret','myTokenValue'];
  for(const key of forbidden) assert.ok(isForbiddenKey(key), key);
});

test('auth fails closed: 401 without/with wrong token; no data in the response', async () => {
  const fetchImpl = mockGasFetch('ok');
  const app = await makeApp(null, fetchImpl);
  const callsBefore = fetchImpl.calls.length;

  const noAuth = await app.fetch(new Request('https://mcp.example.test/mcp', {method:'POST', body:'{"jsonrpc":"2.0","method":"tools/list","id":1}'}));
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.headers.get('WWW-Authenticate'), 'Bearer realm="maister-tracker-mcp"');
  assert.ok(!(await noAuth.text()).includes('tickets'));

  const wrong = await post(app, '{"jsonrpc":"2.0","method":"tools/list","id":1}', {Authorization:'Bearer mt_wrong_0123456789abcdef0123456789abc'});
  assert.equal(wrong.status, 401);

  const forged = await post(app, '{"jsonrpc":"2.0","method":"tools/list","id":1}', {Authorization:'Bearer ' + BEARER_TOKEN.slice(0, -1) + 'X'});
  assert.equal(forged.status, 401);
  assert.equal(fetchImpl.calls.length, callsBefore); // GAS was never contacted
});

test('broken security config -> 503, endpoint disabled (fail closed)', async () => {
  const app = await makeApp(testEnv({MCP_BEARER_TOKENS:'garbage-entry'}), mockGasFetch('ok'));
  const response = await post(app, '{"jsonrpc":"2.0","method":"tools/list","id":1}');
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(body, {error:'server_configuration'});
  const health = await app.fetch(new Request('https://mcp.example.test/healthz'));
  assert.equal(health.status, 200);
});

test('rate limiting: exceeding the per-client limit returns 429', async () => {
  const app = await makeApp(testEnv({MCP_RATE_LIMIT_PER_MIN:'3'}), mockGasFetch('ok'));
  for(let i = 0; i < 3; i++){
    const response = await rpc(app, 'tools/list');
    assert.equal(response.status, 200);
  }
  const limited = await rpc(app, 'tools/list');
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('Retry-After'));
});

test('transport never leaks data on wrong method / wrong path / notifications', async () => {
  const app = await makeApp(null, mockGasFetch('ok'));
  const get = await app.fetch(new Request('https://mcp.example.test/mcp'));
  assert.equal(get.status, 405);
  const del = await app.fetch(new Request('https://mcp.example.test/mcp', {method:'DELETE'}));
  assert.equal(del.status, 405);
  const notFound = await app.fetch(new Request('https://mcp.example.test/other'));
  assert.equal(notFound.status, 404);
  const notification = await post(app, JSON.stringify({jsonrpc:'2.0', method:'notifications/initialized'}));
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
});
