/* v91.60 regression — the "Grok" 502 HTTP_413 incident.

   Production trace (clean chat, «Какой сегодня день», provider switched to
   Groq): PWA → POST /ask {provider:'groq', model:'openai/gpt-oss-120b'} →
   Worker groqAsk → Groq refused with HTTP 413
     «Request too large for model `openai/gpt-oss-120b` in organization
      `org_…` service tier `on_demand` on tokens per minute (TPM):
      Limit 8000, Requested 11176, please reduce your message size…»
   i.e. the per-MINUTE token budget (rendered prompt + DECLARED
   max_completion_tokens), not a body-size problem. groq.js mapped it to
   {code:'HTTP_413'}, index.js knew only 402/429 → 502 ask_failed, and the PWA
   printed «Помилка сервера (502 HTTP_413)».

   Root-cause fix (provider-specific, DeepSeek untouched):
     1) Groq gets compact function descriptions + a 1024-token completion
        reserve with reasoning_effort "low" → a clean-chat turn declares
        ≈7.6K of the 8K TPM budget instead of ≈11.2K;
     2) a TPM 413 is answered as an honest 429 rate-limit (limit/requested
        numbers, wait when Groq gives one, organization id stripped). */
import test from 'node:test';
import assert from 'node:assert/strict';

import {createApp} from '../../src/index.js';
import {createGroqClient, formatGroqTools, GROQ_COMPACT_DESCRIPTIONS, parseTokenBudget} from '../../src/ask/groq.js';
import {formatDeepSeekTools, DEEPSEEK_COMPACT_DESCRIPTIONS} from '../../src/ask/deepseek.js';
import {TOOL_DEFINITIONS, TOOL_NAMES} from '../../src/tools/definitions.js';
import {FIXTURES} from '../fixtures/data.js';
import {BEARER_TOKEN, testEnv} from '../helpers/mcpapp.js';

const GROQ_KEY = 'gsk_test_key_0123456789abcdef0123456789';
const DEEPSEEK_KEY = 'sk-deepseek-test-key-0123456789abcdef0123456789';
const ORG = 'org_01k5abcdefghijklmnopqrstu';
const TPM_413 = 'Request too large for model `openai/gpt-oss-120b` in organization `' + ORG + '` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 11176, please reduce your message size and try again.';

function env(){
  return testEnv({GROQ_API_KEY: GROQ_KEY, DEEPSEEK_API_KEY: DEEPSEEK_KEY});
}
function answer(text){
  return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:text}}]}), {status:200});
}
function makeApp(upstream){
  const calls = {groq:[], deepseek:[], gas:0};
  async function fetchImpl(url, init){
    const u = String(url);
    if(u.includes('api.groq.com')){ calls.groq.push(JSON.parse(init.body)); return upstream.groq(calls.groq.length); }
    if(u.includes('api.deepseek.com')){ calls.deepseek.push(JSON.parse(init.body)); return upstream.deepseek(calls.deepseek.length); }
    if(u.includes('script.google.com')){ calls.gas++; return new Response(JSON.stringify(FIXTURES.baseListPayload), {status:200}); }
    throw new Error('unexpected fetch target: ' + u);
  }
  return {app: createApp(env(), {fetchImpl}), calls};
}
async function ask(app, body){
  const res = await app.fetch(new Request('https://mcp.example.test/ask', {method:'POST',
    headers:{'Content-Type':'application/json', Authorization:'Bearer ' + BEARER_TOKEN}, body:JSON.stringify(body)}));
  return {status:res.status, headers:res.headers, body:await res.json()};
}
const CLEAN_CHAT = {question:'Какой сегодня день', history:[]};

test('Grok 1: provider "groq" from the PWA reaches the Groq upstream with the requested model (never DeepSeek)', async () => {
  const {app, calls} = makeApp({groq: () => answer('Сьогодні неділя.'), deepseek: () => answer('DeepSeek')});
  const out = await ask(app, Object.assign({provider:'groq', model:'openai/gpt-oss-120b'}, CLEAN_CHAT));
  assert.equal(out.status, 200);
  assert.equal(out.body.answer, 'Сьогодні неділя.');
  assert.equal(calls.groq.length, 1, 'one Groq round for a no-tool answer');
  assert.equal(calls.deepseek.length, 0, 'DeepSeek is not consulted when Groq is selected');
  assert.equal(calls.groq[0].model, 'openai/gpt-oss-120b');
});

test('Grok 3: clean-chat Groq request fits the 8K TPM budget: compact descriptions, 1024 reserve, low reasoning effort', async () => {
  const {app, calls} = makeApp({groq: () => answer('ok'), deepseek: () => answer('ok')});
  await ask(app, Object.assign({provider:'groq'}, CLEAN_CHAT));
  const body = calls.groq[0];
  assert.equal(body.max_completion_tokens, 1024, 'declared completion reserve counts against TPM');
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.reasoning_format, 'hidden');
  assert.equal(body.tools.length, TOOL_NAMES.length, 'all 12 READ tools are still offered');
  for(const tool of body.tools){
    assert.equal(tool.function.description, GROQ_COMPACT_DESCRIPTIONS[tool.function.name], tool.function.name + ' uses the compact description');
    const canonical = TOOL_DEFINITIONS.find(function(d){ return d.name === tool.function.name; });
    if(tool.function.name !== 'get_ticket') assert.deepEqual(tool.function.parameters, canonical.inputSchema, tool.function.name + ': schema untouched');
  }
  /* Declared budget = rendered prompt + max_completion_tokens. Offline
     measurement with the gpt-oss harmony renderer for this very request:
     canonical descriptions 7080 prompt tokens + 4096 = 11176 (> 8000, the
     production 413); compact descriptions 6579 + 1024 = 7603 (< 8000).
     Here the description share of the body is pinned so a future edit that
     re-inflates it fails loudly. */
  const descChars = body.tools.reduce(function(sum, t){ return sum + t.function.description.length; }, 0);
  const canonicalChars = TOOL_DEFINITIONS.reduce(function(sum, d){ return sum + d.description.length; }, 0);
  assert.ok(descChars < 1000, 'compact descriptions total ' + descChars + ' chars');
  assert.ok(canonicalChars > 2000, 'canonical descriptions stay verbose for MCP clients (' + canonicalChars + ')');
  assert.ok(!JSON.stringify(body).includes(GROQ_KEY));
});

test('Grok 4: the same clean-chat question on DeepSeek keeps its own settings (nothing cut)', async () => {
  const {app, calls} = makeApp({groq: () => answer('ok'), deepseek: () => answer('Сьогодні неділя.')});
  const out = await ask(app, Object.assign({provider:'deepseek', model:'deepseek-flash'}, CLEAN_CHAT));
  assert.equal(out.status, 200);
  assert.equal(calls.groq.length, 0);
  const body = calls.deepseek[0];
  assert.equal(body.model, 'deepseek-flash');
  assert.equal(body.max_tokens, 4096, 'DeepSeek completion reserve unchanged');
  assert.equal(body.reasoning_effort, undefined, 'Groq-only knob never leaks to DeepSeek');
  assert.equal(body.max_completion_tokens, undefined);
  assert.equal(body.tools.length, 12);
  assert.equal(body.tools[0].function.description, DEEPSEEK_COMPACT_DESCRIPTIONS.list_tickets);
  const groqSystem = null;
  /* the system prompt (context) is byte-identical for both providers */
  const {app: app2, calls: calls2} = makeApp({groq: () => answer('ok'), deepseek: () => answer('ok')});
  await ask(app2, Object.assign({provider:'groq'}, CLEAN_CHAT));
  assert.equal(calls2.groq[0].messages[0].content, body.messages[0].content, 'same system prompt for Groq and DeepSeek');
  assert.equal(groqSystem, null);
});

test('Grok 5 (root cause): Groq TPM 413 → honest 429 token_budget with the numbers, org id stripped, 502 never', async () => {
  const errors = [];
  const orig = console.error; console.error = function(){ errors.push(Array.from(arguments).join(' ')); };
  try{
    const {app} = makeApp({
      groq: () => new Response(JSON.stringify({error:{message:TPM_413, type:'tokens', code:'rate_limit_exceeded'}}), {status:413, headers:{'x-ratelimit-reset-tokens':'7.66s'}}),
      deepseek: () => answer('ok')
    });
    const out = await ask(app, Object.assign({provider:'groq'}, CLEAN_CHAT));
    assert.equal(out.status, 429, 'a budget refusal is a rate limit, not a server error');
    assert.equal(out.body.error, 'rate_limited');
    assert.equal(out.body.code, 'token_budget');
    assert.equal(out.body.provider, 'groq');
    assert.deepEqual(out.body.tokenBudget, {limit:8000, requested:11176});
    assert.equal(out.body.retryAfterSeconds, 8, 'reset-tokens header → wait');
    assert.equal(out.headers.get('Retry-After'), '8');
    assert.match(out.body.detail, /tokens per minute/);
    assert.ok(!out.body.detail.includes(ORG), 'organization id never leaves the Worker');
    assert.ok(!JSON.stringify(out.body).includes(GROQ_KEY));
    assert.ok(!errors.join('\n').includes(ORG), 'org id is not logged either');
  }finally{ console.error = orig; }
});

test('Grok 5b: a genuine body-size 413 (no TPM wording) still maps to 502 HTTP_413 — no false rate limit', async () => {
  const {app} = makeApp({
    groq: () => new Response(JSON.stringify({error:{message:'Request entity too large', type:'invalid_request_error'}}), {status:413}),
    deepseek: () => answer('ok')
  });
  const out = await ask(app, Object.assign({provider:'groq'}, CLEAN_CHAT));
  assert.equal(out.status, 502);
  assert.equal(out.body.code, 'HTTP_413');
  assert.equal(out.body.error, 'ask_failed');
});

test('Grok 6: groq client unit — TOKEN_BUDGET code, parsed budget, wait from message when no header', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({error:{message:TPM_413 + ' Please try again in 12s.'}}), {status:413});
  const client = createGroqClient({fetchImpl, apiKey:GROQ_KEY});
  const result = await client.chat([{role:'user', content:'x'}], []);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TOKEN_BUDGET');
  assert.deepEqual(result.tokenBudget, {limit:8000, requested:11176});
  assert.equal(result.retryAfterSeconds, 12);
  assert.ok(!result.detail.includes(ORG));
  assert.deepEqual(parseTokenBudget('tokens per minute (TPM): Limit 8000, Requested 9000'), {limit:8000, requested:9000});
  assert.deepEqual(parseTokenBudget('Rate limit reached on TPM'), {limit:null, requested:null});
  assert.equal(parseTokenBudget('Request entity too large'), null);
  assert.equal(parseTokenBudget(''), null);
});

test('Grok 7: compact Groq descriptions cover every tool, stay short, and never mutate the canonical definitions', () => {
  const canonical = TOOL_DEFINITIONS.map(function(def){ return {type:'function', function:{name:def.name, description:def.description, parameters:def.inputSchema}}; });
  const before = JSON.stringify(canonical);
  const out = formatGroqTools(canonical);
  assert.equal(JSON.stringify(canonical), before, 'input not mutated');
  assert.equal(out.length, TOOL_NAMES.length);
  let total = 0;
  for(const name of TOOL_NAMES){
    assert.ok(GROQ_COMPACT_DESCRIPTIONS[name], name + ' has a compact description');
    assert.ok(GROQ_COMPACT_DESCRIPTIONS[name].length <= 200, name + ' compact description ≤ 200 chars');
    total += GROQ_COMPACT_DESCRIPTIONS[name].length;
  }
  assert.ok(total < 1000, 'total compact budget ' + total + ' < 1000 chars');
  const canonicalTotal = TOOL_DEFINITIONS.reduce(function(sum, def){ return sum + def.description.length; }, 0);
  assert.ok(total < canonicalTotal / 2, 'less than half of the canonical ' + canonicalTotal + ' chars');
  assert.equal(formatGroqTools([]), undefined);
  assert.equal(formatGroqTools(null), undefined);
  /* DeepSeek's own projection is unchanged by the Groq one */
  assert.equal(formatDeepSeekTools(canonical)[0].function.description, DEEPSEEK_COMPACT_DESCRIPTIONS.list_tickets);
});
