/* Integration tests for DeepSeek provider routing on /ask. */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/index.js';
import { FIXTURES } from '../fixtures/data.js';

const MCP_TOKEN = 'mt_test_token_0123456789abcdef0123456789abcdef';
const DEEPSEEK_KEY = 'sk-deepseek-test-key-0123456789abcdef0123456789';

function makeEnv(overrides){
  return Object.assign({
    GAS_SYNC_URL: 'https://script.google.com/macros/s/TEST/exec',
    GAS_SYNC_HMAC_SECRET: 'test_hmac_secret_value_at_least_32chars!',
    MCP_BEARER_TOKENS: 'tester:' + MCP_TOKEN + ':read',
    DEEPSEEK_API_KEY: DEEPSEEK_KEY,
    DEEPSEEK_MODEL: 'deepseek-flash'
  }, overrides || {});
}

function makeAskApp(env, deepseekReplies){
  const calls = { deepseek: [], gas: [] };
  const replyQueue = (deepseekReplies || []).slice();
  const fetchImpl = async function(url, init){
    const u = String(url);
    if(u.includes('api.deepseek.com')){
      calls.deepseek.push({ url: u, init: init, body: JSON.parse(init.body || '{}') });
      const next = replyQueue.shift() || {
        status: 200,
        body: { choices: [{ message: { role: 'assistant', content: 'Ось відповідь DeepSeek' } }] }
      };
      return new Response(JSON.stringify(next.body), { status: next.status || 200, headers: next.headers || {} });
    }
    if(u.includes('script.google.com')){
      calls.gas.push({ url: u, init: init });
      return new Response(JSON.stringify(FIXTURES.baseListPayload), { status: 200 });
    }
    throw new Error('Unexpected fetch to ' + u);
  };
  return { app: createApp(env || makeEnv(), { fetchImpl }), calls };
}

test('happy path DeepSeek: tool-call list_tickets executed locally, final answer returned', async () => {
  const replies = [
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
                  function: { name: 'list_tickets', arguments: '{"limit":5}' }
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
              content: 'Знайдено 1 заявку на вул. Робоча, 74.'
            }
          }
        ]
      }
    }
  ];

  const { app, calls } = makeAskApp(makeEnv(), replies);
  const res = await app.fetch(new Request('https://worker.test/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + MCP_TOKEN
    },
    body: JSON.stringify({
      question: 'Які заявки сьогодні?',
      provider: 'deepseek',
      model: 'deepseek-flash'
    })
  }));

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.answer, 'Знайдено 1 заявку на вул. Робоча, 74.');
  assert.equal(data.meta.tool_calls, 1);
  assert.ok(Array.isArray(data.tickets));
  assert.ok(data.tickets.length > 0);
  assert.equal(data.tickets[0].id, 't-003');
  assert.equal(calls.deepseek.length, 2);
  assert.equal(calls.deepseek[0].body.model, 'deepseek-flash');
  assert.deepEqual(calls.deepseek[0].body.thinking, { type: 'disabled' });
  assert.equal(calls.deepseek[0].body.tools.length, 9);
  assert.equal(calls.deepseek[0].body.tools[0].function.description, 'Список заявок із фільтрами за датами, типом, сигналом та тегами');
  assert.equal(calls.deepseek[1].body.tools.length, 9);
  assert.equal(calls.deepseek[1].body.tools[0].function.description, 'Список заявок із фільтрами за датами, типом, сигналом та тегами');
  assert.ok(!JSON.stringify(calls.deepseek[0].body).includes('deepseek-chat'));
});

test('invalid provider rejected with 400 invalid_provider', async () => {
  const { app } = makeAskApp(makeEnv());
  const res = await app.fetch(new Request('https://worker.test/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + MCP_TOKEN
    },
    body: JSON.stringify({
      question: 'тест',
      provider: 'unsupported-provider'
    })
  }));
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, 'invalid_provider');
});

test('DeepSeek 402 Insufficient Balance translates to HTTP 402 billing error', async () => {
  const replies = [
    {
      status: 402,
      body: {
        error: {
          message: 'Insufficient Balance. Please recharge your DeepSeek balance.',
          type: 'insufficient_balance'
        }
      }
    }
  ];
  const { app } = makeAskApp(makeEnv(), replies);
  const res = await app.fetch(new Request('https://worker.test/ask', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + MCP_TOKEN
    },
    body: JSON.stringify({
      question: 'тест',
      provider: 'deepseek'
    })
  }));
  assert.equal(res.status, 402);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.code, 'insufficient_balance');
  assert.ok(data.detail.includes('Insufficient Balance'));
});
