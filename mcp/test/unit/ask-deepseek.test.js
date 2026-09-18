/* Unit tests for the DeepSeek chat-completions client and tool formatting. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDeepSeekClient,
  formatDeepSeekTools,
  DEEPSEEK_COMPACT_DESCRIPTIONS,
  parseDurationSeconds,
  retryAfterFromHeaders
} from '../../src/ask/deepseek.js';
import {createGroqClient} from '../../src/ask/groq.js';
import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS, TOOL_NAMES} from '../../src/tools/definitions.js';

const KEY = 'sk-deepseek-test-key-0123456789abcdef0123456789';
const GROQ_KEY = 'gsk_test_groq_key_0123456789abcdef0123456789';

function okResponse(payload){
  return async function(url, init){
    return new Response(JSON.stringify(payload), {status:200});
  };
}

function openaiToolsFromDefinitions(defs){
  return defs.map(function(def){
    return {
      type: 'function',
      function: {
        name: def.name,
        description: String(def.description || ''),
        parameters: def.inputSchema || {type:'object', properties:{}}
      }
    };
  });
}

test('DeepSeek chat sends the documented request shape with deepseek-flash, thinking: {type:"disabled"}, and compact tools', async () => {
  let seen = null;
  const fetchImpl = async function(url, init){
    seen = {url:String(url), method:init.method, headers:init.headers, body:JSON.parse(init.body)};
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'ok'}}]}), {status:200});
  };
  const rawTools = [{type:'function', function:{name:'list_tickets', description:'Very long description', parameters:{type:'object'}}}];
  const client = createDeepSeekClient({fetchImpl, apiKey:KEY, model:'deepseek-flash'});
  const result = await client.chat([{role:'user', content:'привіт'}], rawTools);
  assert.equal(result.ok, true);
  assert.equal(seen.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(seen.body.model, 'deepseek-flash');
  assert.deepEqual(seen.body.thinking, { type: 'disabled' });
  assert.equal(seen.body.tool_choice, 'auto');
  assert.equal(seen.body.max_tokens, 4096);
  assert.equal(seen.body.temperature, undefined);
  // compact description used
  assert.equal(seen.body.tools[0].function.name, 'list_tickets');
  assert.equal(seen.body.tools[0].function.description, DEEPSEEK_COMPACT_DESCRIPTIONS.list_tickets);
  assert.deepEqual(seen.body.tools[0].function.parameters, {type:'object'});
  // the key must never travel in the body
  assert.ok(!JSON.stringify(seen.body).includes(KEY));
});

test('A-D, I: DeepSeek receives exactly 9 READ-only tools with compact descriptions and intact schemas', async () => {
  const canonicalOpenAiTools = openaiToolsFromDefinitions(TOOL_DEFINITIONS);
  assert.equal(canonicalOpenAiTools.length, 9, 'canonical definitions must have exactly 9 tools');

  let seenBody = null;
  const fetchImpl = async function(url, init){
    seenBody = JSON.parse(init.body);
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'ok'}}]}), {status:200});
  };

  const client = createDeepSeekClient({fetchImpl, apiKey:KEY, model:'deepseek-flash'});
  await client.chat([{role:'user', content:'тест'}], canonicalOpenAiTools);

  const outboundTools = seenBody.tools;
  // A. Exactly 9 tools
  assert.equal(outboundTools.length, 9);
  // B. Tool names preserved
  const outboundNames = outboundTools.map(t => t.function.name);
  assert.deepEqual(outboundNames, TOOL_NAMES);
  // I. Only READ tools, no WRITE
  for(const name of outboundNames){
    assert.ok(!name.startsWith('create_') && !name.startsWith('update_') && !name.startsWith('delete_'));
  }

  // C & D. Parameters intact and descriptions are compact
  for(let i = 0; i < TOOL_DEFINITIONS.length; i++){
    const canonical = TOOL_DEFINITIONS[i];
    const outbound = outboundTools[i];
    assert.equal(outbound.function.name, canonical.name);
    assert.deepEqual(outbound.function.parameters, canonical.inputSchema);
    assert.equal(outbound.function.description, DEEPSEEK_COMPACT_DESCRIPTIONS[canonical.name]);
    assert.ok(outbound.function.description.length < canonical.description.length, `compact description for ${canonical.name} must be shorter`);
  }

  // F, G, H
  assert.equal(seenBody.tool_choice, 'auto');
  assert.deepEqual(seenBody.thinking, { type: 'disabled' });
  assert.equal(seenBody.model, 'deepseek-flash');
});

test('E: Groq does NOT get DeepSeek-specific reductions (canonical descriptions preserved)', async () => {
  const canonicalOpenAiTools = openaiToolsFromDefinitions(TOOL_DEFINITIONS);
  let seenBody = null;
  const fetchImpl = async function(url, init){
    seenBody = JSON.parse(init.body);
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'ok'}}]}), {status:200});
  };

  const client = createGroqClient({fetchImpl, apiKey:GROQ_KEY, model:'openai/gpt-oss-120b'});
  await client.chat([{role:'user', content:'тест'}], canonicalOpenAiTools);

  assert.equal(seenBody.tools.length, 9);
  for(let i = 0; i < TOOL_DEFINITIONS.length; i++){
    const canonical = TOOL_DEFINITIONS[i];
    const outbound = seenBody.tools[i];
    assert.equal(outbound.function.name, canonical.name);
    // Groq receives the full canonical description
    assert.equal(outbound.function.description, canonical.description);
  }
});

test('K: Compactness regression test: DeepSeek tool descriptions total size is strictly bounded', async () => {
  const canonicalOpenAiTools = openaiToolsFromDefinitions(TOOL_DEFINITIONS);
  const formatted = formatDeepSeekTools(canonicalOpenAiTools);

  let totalCanonicalDescLen = 0;
  for(const t of canonicalOpenAiTools) totalCanonicalDescLen += t.function.description.length;

  let totalDeepSeekDescLen = 0;
  for(const t of formatted) totalDeepSeekDescLen += t.function.description.length;

  // Canonical descriptions are > 1000 characters
  assert.ok(totalCanonicalDescLen > 1000, `Canonical length: ${totalCanonicalDescLen}`);
  // DeepSeek compact descriptions must be under 500 characters
  assert.ok(totalDeepSeekDescLen < 500, `DeepSeek descriptions total length: ${totalDeepSeekDescLen}`);
  assert.ok(totalDeepSeekDescLen > 200, 'Descriptions must still be substantive and meaningful');
});

test('J: Tool-call round trip: assistant tool_call -> local READ tool -> repeat DeepSeek request with compact tools', async () => {
  const calls = [];
  const replyQueue = [
    {
      status: 200,
      body: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'list_places', arguments: '{"city":"Таромське"}' }
                }
              ]
            }
          }
        ]
      }
    },
    {
      status: 200,
      body: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'У Таромському відомі вулиці: Лісова, Мостова.'
            }
          }
        ]
      }
    }
  ];

  const fetchImpl = async function(url, init){
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    const next = replyQueue.shift();
    return new Response(JSON.stringify(next.body), { status: next.status });
  };

  const client = createDeepSeekClient({fetchImpl, apiKey:KEY, model:'deepseek-flash'});
  const stubTools = {
    list_places: async function(args){
      assert.equal(args.city, 'Таромське');
      return { ok: true, data: { places: [{ city: 'Таромське', street: 'Лісова' }, { city: 'Таромське', street: 'Мостова' }] } };
    }
  };

  const orch = createAskOrchestrator({groq: client, tools: stubTools, toolDefs: TOOL_DEFINITIONS});
  const res = await orch.handle('Які вулиці у Таромському?');

  assert.equal(res.ok, true);
  assert.equal(res.answer, 'У Таромському відомі вулиці: Лісова, Мостова.');
  assert.equal(res.meta.toolCallsMade, 1);
  assert.equal(res.meta.rounds, 2);

  // Both rounds must send deepseek-flash, thinking: disabled, and compact tools
  assert.equal(calls.length, 2);
  for(const call of calls){
    assert.equal(call.body.model, 'deepseek-flash');
    assert.deepEqual(call.body.thinking, { type: 'disabled' });
    assert.equal(call.body.tool_choice, 'auto');
    assert.equal(call.body.tools.length, 9);
    assert.equal(call.body.tools[0].function.description, DEEPSEEK_COMPACT_DESCRIPTIONS.list_tickets);
  }
  // Messages in round 2 must contain the tool response
  assert.equal(calls[1].body.messages[calls[1].body.messages.length - 1].role, 'tool');
  assert.equal(calls[1].body.messages[calls[1].body.messages.length - 1].tool_call_id, 'call_1');
});

test('outbound request explicitly contains model: "deepseek-flash" and thinking: {type:"disabled"}, never replaced with deepseek-chat', async () => {
  let seen = null;
  const fetchImpl = async function(url, init){
    seen = {body:JSON.parse(init.body)};
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'ok'}}]}), {status:200});
  };
  const rawTools = [{type:'function', function:{name:'list_tickets', parameters:{type:'object'}}}];
  const clientExplicit = createDeepSeekClient({fetchImpl, apiKey:KEY, model:'deepseek-flash'});
  await clientExplicit.chat([{role:'user', content:'тест'}], rawTools);
  assert.equal(seen.body.model, 'deepseek-flash');
  assert.deepEqual(seen.body.thinking, { type: 'disabled' });
  assert.ok(!JSON.stringify(seen.body).includes('deepseek-chat'));

  const clientDefault = createDeepSeekClient({fetchImpl, apiKey:KEY});
  await clientDefault.chat([{role:'user', content:'тест 2'}], rawTools);
  assert.equal(seen.body.model, 'deepseek-flash');
  assert.deepEqual(seen.body.thinking, { type: 'disabled' });
  assert.ok(!JSON.stringify(seen.body).includes('deepseek-chat'));
});

test('explicit temperature is forwarded to DeepSeek', async () => {
  let body = null;
  const fetchImpl = async function(url, init){
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'ok'}}]}), {status:200});
  };
  await createDeepSeekClient({fetchImpl, apiKey:KEY, temperature:0.3}).chat([], []);
  assert.equal(body.temperature, 0.3);
});

test('DeepSeek tool_calls are parsed into {id, name, argsRaw}', async () => {
  const fetchImpl = okResponse({choices:[{message:{role:'assistant', content:'', tool_calls:[
    {id:'call_ds_1', type:'function', function:{name:'list_tickets', arguments:'{"limit":5}'}}
  ]}}]});
  const client = createDeepSeekClient({fetchImpl, apiKey:KEY});
  const result = await client.chat([], []);
  assert.equal(result.ok, true);
  assert.equal(result.content, '');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].id, 'call_ds_1');
  assert.equal(result.toolCalls[0].name, 'list_tickets');
  assert.equal(result.toolCalls[0].argsRaw, '{"limit":5}');
});

test('non-string arguments in DeepSeek reply are stringified', async () => {
  const fetchImpl = okResponse({choices:[{message:{tool_calls:[
    {type:'function', function:{name:'get_ticket', arguments:{ticket_id:'t-42'}}}
  ]}}]});
  const client = createDeepSeekClient({fetchImpl, apiKey:KEY});
  const result = await client.chat([], []);
  assert.equal(result.toolCalls[0].id, 'call_0');
  assert.equal(result.toolCalls[0].argsRaw, '{"ticket_id":"t-42"}');
});

test('DeepSeek HTTP 401 Unauthorized sanitized properly', async () => {
  const fetchImpl = async function(){ return new Response('Unauthorized', {status:401}); };
  const client = createDeepSeekClient({fetchImpl, apiKey:KEY});
  const result = await client.chat([], []);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_401');
  assert.equal(result.message, 'DeepSeek responded 401');
  assert.equal(result.detail, 'Unauthorized');
});

test('DeepSeek HTTP 402 Insufficient Balance maps to HTTP_402 with sanitized message', async () => {
  const fetchImpl = async function(){
    return new Response(JSON.stringify({error:{message:'Insufficient Balance. Please top up your account.', type:'insufficient_balance'}}), {status:402});
  };
  const client = createDeepSeekClient({fetchImpl, apiKey:KEY});
  const result = await client.chat([], []);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_402');
  assert.ok(result.detail.includes('Insufficient Balance'));
  assert.ok(!result.detail.includes(KEY));
});

test('DeepSeek HTTP 429 returns retry-after if provided', async () => {
  const fetchImpl = async function(){
    return new Response(JSON.stringify({error:{message:'Rate limit reached'}}), {
      status:429, headers:{'retry-after':'15'}
    });
  };
  const result = await createDeepSeekClient({fetchImpl, apiKey:KEY}).chat([], []);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_429');
  assert.equal(result.retryAfterSeconds, 15);
});

test('DeepSeek network failure and timeout map to NETWORK', async () => {
  const throwing = async function(){ throw new Error('connection reset'); };
  assert.equal((await createDeepSeekClient({fetchImpl:throwing, apiKey:KEY}).chat([], [])).code, 'NETWORK');
});
