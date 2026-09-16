/* Integration tests for the /ask endpoint (stage D) through the full Worker:
   auth, config gating, tool-loop against mock Groq + mock GAS, protections,
   and proof that no secrets and no self-HTTP to /mcp occur. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createApp} from '../../src/index.js';
import {FIXTURES} from '../fixtures/data.js';
import {BEARER_TOKEN, testEnv, post, rpc} from '../helpers/mcpapp.js';

const GROQ_KEY = 'gsk_test_key_0123456789abcdef0123456789';
const ASK_TOKEN = 'mt_pwa_client_0123456789abcdef0123456789ab';

function askEnv(overrides){
  return testEnv(Object.assign({GROQ_API_KEY: GROQ_KEY}, overrides || {}));
}

function groqReplyToolCall(){
  return function(url, init){
    const body = JSON.parse(init.body);
    if(body.messages.length <= 2){
      return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'', tool_calls:[
        {id:'call_1', type:'function', function:{name:'list_tickets', arguments:'{"limit":5}'}}
      ]}}]}), {status:200});
    }
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'За останні заявки: 5 штук (за даними інструменту).'}}]}), {status:200});
  };
}

function combinedFetch(groqHandler, gasBehavior){
  const gasCalls = [];
  const calls = [];
  async function fetchImpl(url, init){
    const urlText = String(url);
    calls.push({url:urlText, init});
    if(urlText.includes('api.groq.com')) return groqHandler(url, init);
    if(urlText.includes('script.google.com')){
      gasCalls.push(urlText);
      return new Response(JSON.stringify(FIXTURES.baseListPayload), {status:200});
    }
    throw new Error('unexpected fetch target: ' + urlText);
  }
  fetchImpl.gasCalls = gasCalls;
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function makeAskApp(env, groqHandler){
  const fetchImpl = combinedFetch(groqHandler || groqReplyToolCall());
  const app = createApp(env || askEnv(), {fetchImpl});
  await app.appPromise;
  return {app, fetchImpl};
}

async function postAsk(app, bodyText, headers){
  return app.fetch(new Request('https://mcp.example.test/ask', {
    method:'POST',
    headers: Object.assign({'Content-Type':'application/json', Authorization:'Bearer ' + BEARER_TOKEN}, headers || {}),
    body: bodyText
  }));
}

const ASK_BODY = JSON.stringify({question:'Скільки заявок зараз у базі?'});

test('/ask requires auth: 401 without token, wrong token, and GAS never contacted', async () => {
  const {app, fetchImpl} = await makeAskApp();
  const before = fetchImpl.gasCalls.length;
  const noAuth = await app.fetch(new Request('https://mcp.example.test/ask', {method:'POST', body:ASK_BODY}));
  assert.equal(noAuth.status, 401);
  const wrong = await postAsk(app, ASK_BODY, {Authorization:'Bearer mt_wrong_0123456789abcdef0123456789abc'});
  assert.equal(wrong.status, 401);
  assert.equal(fetchImpl.gasCalls.length, before);
});

test('without GROQ_API_KEY: /ask is 503 ask_not_configured while /mcp keeps working', async () => {
  const env = testEnv(); // no GROQ_API_KEY
  const {app} = await makeAskApp(env, null);
  const ask = await postAsk(app, ASK_BODY);
  assert.equal(ask.status, 503);
  const body = await ask.json();
  assert.deepEqual(body, {error:'ask_not_configured'});
  const mcp = await rpc(app, 'tools/list');
  assert.equal(mcp.status, 200);
});

test('happy path: Groq tool-call executed locally, final answer returned, no self-HTTP to /mcp', async () => {
  const {app, fetchImpl} = await makeAskApp();
  const response = await postAsk(app, ASK_BODY);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.match(body.answer, /5 штук/);
  assert.equal(body.meta.tool_calls, 1);
  assert.equal(body.meta.rounds, 2);
  // GAS was read through the tools (list_tickets -> signed GET list)
  assert.ok(fetchImpl.gasCalls.length >= 1);
  // orchestrator must NOT call its own /mcp endpoint
  const targets = fetchImpl.calls.map(function(call){ return call.url; });
  assert.ok(!targets.some(function(url){ return url.includes('/mcp'); }));
  // request to Groq carried the READ tools; the key never appears in any fetch body
  const groqCall = fetchImpl.calls.find(function(call){ return call.url.includes('api.groq.com'); });
  const groqBody = JSON.parse(groqCall.init.body);
  assert.equal(groqBody.tools.length, 7);
  assert.ok(!JSON.stringify(groqBody).includes(GROQ_KEY));
});

test('secrets and forbidden fields never appear in /ask responses', async () => {
  const {app} = await makeAskApp();
  const response = await postAsk(app, ASK_BODY);
  const text = await response.text();
  assert.ok(!text.includes(GROQ_KEY));
  assert.ok(!text.includes('fullDataJson'));
  assert.ok(!text.includes('"password"'));
  assert.ok(!text.includes('tgPhotoFileIds'));
  assert.ok(!text.includes('gsk_'));
});

test('malformed Groq payload -> controlled 502 ask_failed MALFORMED', async () => {
  const {app} = await makeAskApp(askEnv(), function(){ return new Response('<html>', {status:200}); });
  const response = await postAsk(app, ASK_BODY);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error, 'ask_failed');
  assert.equal(body.code, 'MALFORMED');
});

test('Groq 401 -> controlled 502 ask_failed HTTP_401', async () => {
  const {app} = await makeAskApp(askEnv(), function(){ return new Response('Unauthorized', {status:401}); });
  const response = await postAsk(app, ASK_BODY);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.code, 'HTTP_401');
});

test('runaway tool-loop terminates with TOO_MANY_TOOL_CALLS', async () => {
  const infinite = function(){
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'', tool_calls:[
      {id:'call_n', type:'function', function:{name:'list_tickets', arguments:'{}'}}
    ]}}]}), {status:200});
  };
  const {app} = await makeAskApp(askEnv(), infinite);
  const response = await postAsk(app, ASK_BODY);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.code, 'TOO_MANY_TOOL_CALLS');
});

test('model requesting an unknown/WRITE tool never executes it and the loop recovers', async () => {
  let stage = 0;
  const handler = function(url, init){
    const body = JSON.parse(init.body);
    stage++;
    if(stage === 1){
      return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'', tool_calls:[
        {id:'c1', type:'function', function:{name:'create_ticket', arguments:'{}'}}
      ]}}]}), {status:200});
    }
    if(stage === 2){
      return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'', tool_calls:[
        {id:'c2', type:'function', function:{name:'nonexistent_tool', arguments:'{}'}}
      ]}}]}), {status:200});
    }
    assert.ok(body.messages.some(function(m){ return m.role === 'tool' && m.content.includes('UNKNOWN_TOOL'); }));
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'Записати заявки я не можу — сервер лише читає.'}}]}), {status:200});
  };
  const {app, fetchImpl} = await makeAskApp(askEnv(), handler);
  const response = await postAsk(app, JSON.stringify({question:'створи заявку'}));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  // the only GAS traffic is the successful list read (no writes, nothing else)
  assert.ok(fetchImpl.gasCalls.every(function(url){ return url.includes('action=list'); }));
});

test('question validation: bad JSON / missing / oversized question -> 400', async () => {
  const {app} = await makeAskApp();
  assert.equal((await postAsk(app, 'not json')).status, 400);
  assert.equal((await postAsk(app, '{}')).status, 400);
  assert.equal((await postAsk(app, JSON.stringify({question:''}))).status, 400);
  assert.equal((await postAsk(app, JSON.stringify({question:'x'.repeat(2500)}))).status, 400);
});

test('GET /ask -> 405', async () => {
  const {app} = await makeAskApp();
  const response = await app.fetch(new Request('https://mcp.example.test/ask'));
  assert.equal(response.status, 405);
});

test('rate limit applies to /ask per client', async () => {
  const env = askEnv({MCP_RATE_LIMIT_PER_MIN:'2'});
  const {app} = await makeAskApp(env);
  assert.equal((await postAsk(app, ASK_BODY)).status, 200);
  assert.equal((await postAsk(app, ASK_BODY)).status, 200);
  const limited = await postAsk(app, ASK_BODY);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('Retry-After'));
});

test('ASK_BEARER_TOKENS: separate token accepted for /ask, MCP token rejected there; /mcp unaffected', async () => {
  const env = askEnv({ASK_BEARER_TOKENS:'pwa:' + ASK_TOKEN + ':read'});
  const {app} = await makeAskApp(env);
  const withAsk = await app.fetch(new Request('https://mcp.example.test/ask', {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer ' + ASK_TOKEN}, body:ASK_BODY
  }));
  assert.equal(withAsk.status, 200);
  const withMcp = await postAsk(app, ASK_BODY);
  assert.equal(withMcp.status, 401);
  const mcp = await rpc(app, 'tools/list');
  assert.equal(mcp.status, 200); // MCP token still fully valid for /mcp
});

test('config rejection reason never contains the Groq key', async () => {
  const env = askEnv({ASK_BEARER_TOKENS:'garbage'});
  const {app} = await makeAskApp(env);
  const response = await postAsk(app, ASK_BODY);
  assert.equal(response.status, 503); // ask disabled due to invalid ASK tokens
  const text = await response.text();
  assert.ok(!text.includes(GROQ_KEY));
});
