/* Unit tests for the Groq chat-completions client (stage D). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createGroqClient} from '../../src/ask/groq.js';

const KEY = 'gsk_test_key_0123456789abcdef0123456789';
const TOOLS = [{type:'function', function:{name:'list_tickets', parameters:{type:'object'}}}];

function okResponse(payload){
  return async function(url, init){
    return new Response(JSON.stringify(payload), {status:200});
  };
}

test('chat sends the documented request shape; key only in Authorization header', async () => {
  let seen = null;
  const fetchImpl = async function(url, init){
    seen = {url:String(url), method:init.method, headers:init.headers, body:JSON.parse(init.body)};
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'ok'}}]}), {status:200});
  };
  const client = createGroqClient({fetchImpl, apiKey:KEY, model:'openai/gpt-oss-120b'});
  const result = await client.chat([{role:'user', content:'привіт'}], TOOLS);
  assert.equal(result.ok, true);
  assert.equal(seen.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(seen.body.model, 'openai/gpt-oss-120b');
  assert.deepEqual(seen.body.tools, TOOLS);
  assert.equal(seen.body.tool_choice, 'auto');
  // gpt-oss on Groq: documented token param, no temperature by default,
  // reasoning hidden while tools are attached
  assert.equal(seen.body.max_completion_tokens, 4096);
  assert.equal(seen.body.max_tokens, undefined);
  assert.equal(seen.body.temperature, undefined);
  assert.equal(seen.body.reasoning_format, 'hidden');
  // the key must never travel in the body
  assert.ok(!JSON.stringify(seen.body).includes(KEY));
});

test('explicit temperature is forwarded', async () => {
  let body = null;
  const fetchImpl = async function(url, init){
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'ok'}}]}), {status:200});
  };
  await createGroqClient({fetchImpl, apiKey:KEY, temperature:0.2}).chat([], TOOLS);
  assert.equal(body.temperature, 0.2);
});

test('tool_calls are parsed into {id, name, argsRaw}', async () => {
  const fetchImpl = okResponse({choices:[{message:{role:'assistant', content:'', tool_calls:[
    {id:'call_1', type:'function', function:{name:'list_tickets', arguments:'{"limit":5}'}}
  ]}}]});
  const client = createGroqClient({fetchImpl, apiKey:KEY});
  const result = await client.chat([], TOOLS);
  assert.equal(result.ok, true);
  assert.equal(result.content, '');
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].id, 'call_1');
  assert.equal(result.toolCalls[0].name, 'list_tickets');
  assert.equal(result.toolCalls[0].argsRaw, '{"limit":5}');
});

test('non-string arguments are stringified; missing id gets a fallback', async () => {
  const fetchImpl = okResponse({choices:[{message:{tool_calls:[
    {type:'function', function:{name:'get_ticket', arguments:{ticket_id:'t-1'}}}
  ]}}]});
  const client = createGroqClient({fetchImpl, apiKey:KEY});
  const result = await client.chat([], TOOLS);
  assert.equal(result.toolCalls[0].id, 'call_0');
  assert.equal(result.toolCalls[0].argsRaw, '{"ticket_id":"t-1"}');
});

test('HTTP errors map to stable codes without leaking the key', async () => {
  const fetchImpl = async function(){ return new Response('Unauthorized', {status:401}); };
  const client = createGroqClient({fetchImpl, apiKey:KEY});
  const result = await client.chat([], TOOLS);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_401');
  assert.equal(result.message, 'Groq responded 401');
  assert.equal(result.detail, 'Unauthorized');
});

test('Groq 400 body becomes sanitized detail: exact cause, no key leak', async () => {
  const logged = [];
  const origError = console.error;
  console.error = function(){ logged.push(Array.from(arguments).map(String).join(' ')); };
  try{
    const groqMessage = "'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead. (key=" + KEY + ', echo gsk_lookalike123456789)';
    const fetchImpl = async function(){
      return new Response(JSON.stringify({error:{message:groqMessage, type:'invalid_request_error'}}), {status:400});
    };
    const client = createGroqClient({fetchImpl, apiKey:KEY});
    const result = await client.chat([], TOOLS);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'HTTP_400');
    assert.ok(result.detail.includes('max_completion_tokens'), 'detail must carry the real cause');
    assert.ok(!result.detail.includes(KEY), 'detail must not contain the API key');
    assert.ok(!result.detail.includes('gsk_lookalike'), 'detail must not contain token lookalikes');
    const logText = logged.join('\n');
    assert.ok(!logText.includes(KEY), 'log must not contain the API key');
    assert.ok(!logText.includes('gsk_lookalike'), 'log must not contain token lookalikes');
  }finally{
    console.error = origError;
  }
});

test('malformed payloads map to MALFORMED', async () => {
  const notJson = async function(){ return new Response('<html>nope</html>', {status:200}); };
  assert.equal((await createGroqClient({fetchImpl:notJson, apiKey:KEY}).chat([], TOOLS)).code, 'MALFORMED');
  const noMessage = async function(){ return new Response(JSON.stringify({choices:[]}), {status:200}); };
  assert.equal((await createGroqClient({fetchImpl:noMessage, apiKey:KEY}).chat([], TOOLS)).code, 'MALFORMED');
});

test('network failure and timeout map to NETWORK', async () => {
  const throwing = async function(){ throw new Error('boom'); };
  assert.equal((await createGroqClient({fetchImpl:throwing, apiKey:KEY}).chat([], TOOLS)).code, 'NETWORK');
  const slow = function(url, init){
    return new Promise(function(resolve, reject){
      init.signal.addEventListener('abort', function(){
        const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
      });
      setTimeout(function(){ resolve(new Response('{}', {status:200})); }, 500);
    });
  };
  const client = createGroqClient({fetchImpl:slow, apiKey:KEY, timeoutMs:25});
  const result = await client.chat([], TOOLS);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NETWORK');
});
