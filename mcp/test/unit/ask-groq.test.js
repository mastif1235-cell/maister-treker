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
  // the key must never travel in the body
  assert.ok(!JSON.stringify(seen.body).includes(KEY));
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
  assert.deepEqual(result, {ok:false, code:'HTTP_401', message:'Groq responded 401'});
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
