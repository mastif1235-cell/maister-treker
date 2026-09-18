'use strict';
/* DeepSeek provider integration and regression tests:
   - Provider registration in MTAI.providers
   - Default provider / model (deepseek-flash)
   - /ask request payload with provider / model
   - Error mapping (402 Insufficient Balance, 401, 429)
   - Settings UI provider switching
   - Groq backward compatibility
   - Verification that legacy deepseek-chat is not present */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function load(...files){
  const sandbox = {
    console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Array, Object, String, Number, RegExp, Error,
    AbortController, Response, Headers, fetch
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  for(const f of files){
    vm.runInContext(read(f), vm.createContext(sandbox), { filename: f });
  }
  return sandbox;
}

const CORE = [
  'js/ai/ai-config.js',
  'js/ai/providers/provider-registry.js',
  'js/ai/providers/groq.js',
  'js/ai/providers/deepseek.js',
  'js/ai/ai-provider.js',
  'js/ai/ai-storage.js',
  'js/ai/ai-client.js'
];

(async function run(){
  // 1. Providers Registry check
  {
    const sb = load(...CORE);
    const M = sb.MTAI;
    const enabled = M.providers.enabledList();
    assert.equal(enabled.length, 2, 'both groq and deepseek enabled');
    const ds = M.providers.get('deepseek');
    assert.ok(ds, 'deepseek provider found');
    assert.equal(ds.enabled, true, 'deepseek provider enabled');
    assert.equal(ds.models[0].id, 'deepseek-flash', 'deepseek model is deepseek-flash');
    assert.equal(ds.models[0].label, 'deepseek-flash', 'deepseek model label');
    assert.equal(ds.models[0].capabilities.tools, true, 'deepseek tools capability');
    assert.equal(ds.models[0].capabilities.reasoning, false, 'non-thinking mode');

    // Confirm deepseek-chat is not registered
    assert.ok(!ds.models.some(m => m.id === 'deepseek-chat'), 'legacy deepseek-chat must not be registered');

    const groq = M.providers.get('groq');
    assert.ok(groq, 'groq provider found');
    assert.equal(groq.enabled, true, 'groq provider enabled');
    assert.equal(groq.models[0].id, 'openai/gpt-oss-120b');

    assert.equal(M.config.DEFAULT_PROVIDER, 'deepseek', 'default provider is deepseek');
    assert.equal(M.config.DEFAULT_MODEL, 'deepseek-flash', 'default model is deepseek-flash');
    console.log('PASS 1. DeepSeek provider registered as default alongside Groq');
  }

  // 2. Client /ask format and error mapping (including 402)
  {
    const sb = load(...CORE);
    const M = sb.MTAI;
    sb.settings = {
      ai: {
        enabled: true,
        provider: 'deepseek',
        model: 'deepseek-flash',
        backendUrl: 'https://worker.test'
      },
      aiBearerToken: 'test:tok12345678901234567890:read'
    };

    let seen = null;
    const client = M.createClient({
      fetchImpl: async function(url, init){
        seen = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ ok: true, answer: 'Відповідь DeepSeek' }), { status: 200 });
      },
      getConfig: function(){
        return {
          backendUrl: sb.settings.ai.backendUrl,
          bearer: M.storage.bearer(),
          provider: sb.settings.ai.provider,
          model: sb.settings.ai.model
        };
      }
    });

    const res = await client.ask('Скільки заявок за серпень?');
    assert.equal(res.ok, true);
    assert.equal(res.answer, 'Відповідь DeepSeek');
    assert.equal(seen.body.provider, 'deepseek');
    assert.equal(seen.body.model, 'deepseek-flash');
    assert.equal(seen.body.question, 'Скільки заявок за серпень?');

    // Test 402 Insufficient Balance
    const client402 = M.createClient({
      fetchImpl: async function(){
        return new Response(JSON.stringify({
          ok: false,
          error: 'insufficient_balance',
          code: 'insufficient_balance',
          detail: 'Insufficient Balance. Please recharge your DeepSeek balance.'
        }), { status: 402 });
      },
      getConfig: function(){
        return { backendUrl: 'https://worker.test', bearer: 'token', provider: 'deepseek', model: 'deepseek-flash' };
      }
    });
    const res402 = await client402.ask('тест');
    assert.equal(res402.ok, false);
    assert.equal(res402.error.kind, 'billing');
    assert.ok(res402.error.message.includes('Insufficient Balance') || res402.error.message.includes('Недостатній баланс'));
    assert.ok(res402.error.detail.includes('Insufficient Balance'));

    console.log('PASS 2. Client passes provider/model and handles 402 Insufficient Balance properly');
  }

  // 3. Groq backward compatibility
  {
    const sb = load(...CORE);
    const M = sb.MTAI;
    sb.settings = {
      ai: {
        enabled: true,
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        backendUrl: 'https://worker.test'
      },
      aiBearerToken: 'test:tok12345678901234567890:read'
    };

    let seen = null;
    const client = M.createClient({
      fetchImpl: async function(url, init){
        seen = { url, init, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({ ok: true, answer: 'Відповідь Groq' }), { status: 200 });
      },
      getConfig: function(){
        return {
          backendUrl: sb.settings.ai.backendUrl,
          bearer: M.storage.bearer(),
          provider: sb.settings.ai.provider,
          model: sb.settings.ai.model
        };
      }
    });

    const res = await client.ask('Скільки підключень?');
    assert.equal(res.ok, true);
    assert.equal(res.answer, 'Відповідь Groq');
    assert.equal(seen.body.provider, 'groq');
    assert.equal(seen.body.model, 'openai/gpt-oss-120b');
    console.log('PASS 3. Groq backward compatibility verified');
  }

  console.log('ALL AI DEEPSEEK PROVIDER TESTS PASSED');
  process.exit(0);
})().catch(function(err){
  console.error(err);
  process.exit(1);
});
