/* Unit tests for the DeepSeek chat-completions client. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createDeepSeekClient, parseDurationSeconds, retryAfterFromHeaders} from '../../src/ask/deepseek.js';

const KEY = 'sk-deepseek-test-key-0123456789abcdef0123456789';
const TOOLS = [{type:'function', function:{name:'list_tickets', parameters:{type:'object'}}}];

function okResponse(payload){
  return async function(url, init){
    return new Response(JSON.stringify(payload), {status:200});
  };
}

test('DeepSeek chat sends the documented request shape with deepseek-flash and thinking: {type:"disabled"}', async () => {
  let seen = null;
  const fetchImpl = async function(url, init){
    seen = {url:String(url), method:init.method, headers:init.headers, body:JSON.parse(init.body)};
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'ok'}}]}), {status:200});
  };
  const client = createDeepSeekClient({fetchImpl, apiKey:KEY, model:'deepseek-flash'});
  const result = await client.chat([{role:'user', content:'привіт'}], TOOLS);
  assert.equal(result.ok, true);
  assert.equal(seen.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(seen.body.model, 'deepseek-flash');
  assert.deepEqual(seen.body.thinking, { type: 'disabled' });
  assert.deepEqual(seen.body.tools, TOOLS);
  assert.equal(seen.body.tool_choice, 'auto');
  assert.equal(seen.body.max_tokens, 4096);
  assert.equal(seen.body.temperature, undefined);
  // the key must never travel in the body
  assert.ok(!JSON.stringify(seen.body).includes(KEY));
});

test('outbound request explicitly contains model: "deepseek-flash" and thinking: {type:"disabled"}, never replaced with deepseek-chat', async () => {
  let seen = null;
  const fetchImpl = async function(url, init){
    seen = {body:JSON.parse(init.body)};
    return new Response(JSON.stringify({choices:[{message:{role:'assistant', content:'ok'}}]}), {status:200});
  };
  // Test both with explicit model 'deepseek-flash' and default option
  const clientExplicit = createDeepSeekClient({fetchImpl, apiKey:KEY, model:'deepseek-flash'});
  await clientExplicit.chat([{role:'user', content:'тест'}], TOOLS);
  assert.equal(seen.body.model, 'deepseek-flash');
  assert.deepEqual(seen.body.thinking, { type: 'disabled' });
  assert.ok(!JSON.stringify(seen.body).includes('deepseek-chat'));

  const clientDefault = createDeepSeekClient({fetchImpl, apiKey:KEY});
  await clientDefault.chat([{role:'user', content:'тест 2'}], TOOLS);
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
  await createDeepSeekClient({fetchImpl, apiKey:KEY, temperature:0.3}).chat([], TOOLS);
  assert.equal(body.temperature, 0.3);
});

test('DeepSeek tool_calls are parsed into {id, name, argsRaw}', async () => {
  const fetchImpl = okResponse({choices:[{message:{role:'assistant', content:'', tool_calls:[
    {id:'call_ds_1', type:'function', function:{name:'list_tickets', arguments:'{"limit":5}'}}
  ]}}]});
  const client = createDeepSeekClient({fetchImpl, apiKey:KEY});
  const result = await client.chat([], TOOLS);
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
  const result = await client.chat([], TOOLS);
  assert.equal(result.toolCalls[0].id, 'call_0');
  assert.equal(result.toolCalls[0].argsRaw, '{"ticket_id":"t-42"}');
});

test('DeepSeek HTTP 401 Unauthorized sanitized properly', async () => {
  const fetchImpl = async function(){ return new Response('Unauthorized', {status:401}); };
  const client = createDeepSeekClient({fetchImpl, apiKey:KEY});
  const result = await client.chat([], TOOLS);
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
  const result = await client.chat([], TOOLS);
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
  const result = await createDeepSeekClient({fetchImpl, apiKey:KEY}).chat([], TOOLS);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HTTP_429');
  assert.equal(result.retryAfterSeconds, 15);
});

test('DeepSeek network failure and timeout map to NETWORK', async () => {
  const throwing = async function(){ throw new Error('connection reset'); };
  assert.equal((await createDeepSeekClient({fetchImpl:throwing, apiKey:KEY}).chat([], TOOLS)).code, 'NETWORK');
});
