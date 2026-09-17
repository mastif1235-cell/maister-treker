/* Unit tests for the Groq chat-completions client (stage D). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createGroqClient, parseDurationSeconds, retryAfterFromHeaders, retryAfterFromMessage} from '../../src/ask/groq.js';

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


/* ── Groq rate-limit contract (console.groq.com/docs/rate-limits) ───────────
   retry-after: seconds, only on 429; x-ratelimit-reset-tokens (TPM) and
   x-ratelimit-reset-requests (RPD) are Go-style durations ("7.66s",
   "2m59.56s"). The real wait must survive to the client so the UI can show a
   truthful countdown instead of a made-up 20-30 s. */

test('parseDurationSeconds understands Groq duration strings', () => {
  assert.equal(parseDurationSeconds('2'), 2);
  assert.equal(parseDurationSeconds('7.66s'), 8);        // ceil
  assert.equal(parseDurationSeconds('2m59.56s'), 180);
  assert.equal(parseDurationSeconds('1m30s'), 90);
  assert.equal(parseDurationSeconds('500ms'), 1);        // never below 1s
  assert.equal(parseDurationSeconds('1h'), 3600);
  assert.equal(parseDurationSeconds(''), null);
  assert.equal(parseDurationSeconds(null), null);
  assert.equal(parseDurationSeconds('soon'), null);
  assert.equal(parseDurationSeconds('0'), null);
});

test('retryAfterFromHeaders prefers retry-after, falls back to reset hints', () => {
  const h = (obj) => new Headers(obj);
  assert.equal(retryAfterFromHeaders(h({'retry-after':'73'})), 73);
  // retry-after wins over the reset hints
  assert.equal(retryAfterFromHeaders(h({'retry-after':'41', 'x-ratelimit-reset-tokens':'7.66s'})), 41);
  // no retry-after -> use the reset hints (worst case of the two)
  assert.equal(retryAfterFromHeaders(h({'x-ratelimit-reset-tokens':'7.66s'})), 8);
  assert.equal(retryAfterFromHeaders(h({'x-ratelimit-reset-tokens':'7.66s', 'x-ratelimit-reset-requests':'2m59.56s'})), 180);
  // nothing usable -> null (the UI must NOT invent a countdown)
  assert.equal(retryAfterFromHeaders(h({})), null);
  assert.equal(retryAfterFromHeaders(null), null);
});

test('retryAfterFromMessage reads the wait out of Groq error prose', () => {
  assert.equal(retryAfterFromMessage('Rate limit reached. Please try again in 7.66s.'), 8);
  assert.equal(retryAfterFromMessage('please try again in 1m30s'), 90);
  assert.equal(retryAfterFromMessage('rate limited'), null);
});

test('429 keeps the REAL wait from the retry-after header (no clamping)', async () => {
  const fetchImpl = async function(){
    return new Response(JSON.stringify({error:{message:'Rate limit reached for tokens'}}), {
      status:429, headers:{'retry-after':'73', 'x-ratelimit-reset-tokens':'7.66s'}
    });
  };
  const result = await createGroqClient({fetchImpl, apiKey:KEY}).chat([], TOOLS);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_429');
  assert.equal(result.retryAfterSeconds, 73);
});

test('429 without retry-after falls back to reset-tokens, then to the message', async () => {
  const viaReset = async function(){
    return new Response(JSON.stringify({error:{message:'Rate limit reached'}}), {
      status:429, headers:{'x-ratelimit-reset-tokens':'41s'}
    });
  };
  assert.equal((await createGroqClient({fetchImpl:viaReset, apiKey:KEY}).chat([], TOOLS)).retryAfterSeconds, 41);

  const viaMessage = async function(){
    return new Response(JSON.stringify({error:{message:'Rate limit reached for model. Please try again in 12.5s.'}}), {status:429});
  };
  assert.equal((await createGroqClient({fetchImpl:viaMessage, apiKey:KEY}).chat([], TOOLS)).retryAfterSeconds, 13);
});

test('429 with no timing information at all reports null (never a guess)', async () => {
  const fetchImpl = async function(){ return new Response('Too Many Requests', {status:429}); };
  const result = await createGroqClient({fetchImpl, apiKey:KEY}).chat([], TOOLS);
  assert.equal(result.code, 'HTTP_429');
  assert.equal(result.retryAfterSeconds, null);
});

test('non-429 errors carry no retryAfterSeconds', async () => {
  const fetchImpl = async function(){ return new Response('Unauthorized', {status:401}); };
  const result = await createGroqClient({fetchImpl, apiKey:KEY}).chat([], TOOLS);
  assert.equal(result.code, 'HTTP_401');
  assert.equal(result.retryAfterSeconds, undefined);
});
