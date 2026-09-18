'use strict';
// Unit-тести чистих AI-модулів (vm, без браузера): реєстр провайдерів,
// сховище, клієнт (mock fetch: 200/400/401/429/500/network/timeout),
// рендерер (fake DOM, XSS-safe), контролер чату (retry/rate-limit).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');

function load(...files){
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Array, Object, String, Number, RegExp, Error, AbortController, Response, Headers, fetch };
  sandbox.globalThis=sandbox; sandbox.window=undefined;
  for(const f of files) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),vm.createContext(sandbox),{filename:f});
  return sandbox;
}
const CORE=['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js'];

// ── реєстр провайдерів +capabilities ──
{
  const sb=load(...CORE);
  const M=sb.MTAI;
  const list=M.providers.enabledList();
  assert.equal(list.length,2,'both groq and deepseek enabled');
  assert.equal(M.providers.get('deepseek').enabled,true,'deepseek is active');
  assert.equal(M.providers.get('deepseek').models[0].id,'deepseek-flash');
  assert.equal(M.providers.get('groq').enabled,true,'groq is active');
  assert.equal(M.providers.get('groq').models[0].id,'openai/gpt-oss-120b');
  assert.equal(M.providers.get('groq').models[0].capabilities.tools,true);
  assert.equal(M.provider.capsLabel({text:true,vision:true,tools:true}),'Текст · Фото · Tools');
  console.log('PASS provider registry: groq and deepseek active, capabilities');
}

// ── storage: allowlist, bearer mid-part, readiness ──
{
  const sb=load(...CORE);
  const M=sb.MTAI;
  sb.settings={}; sb.saveSettings=function(){ sb.saved=true; };
  const ai=M.storage.ensure();
  assert.equal(ai.enabled,false,'fresh: AI OFF');
  assert.equal(ai.backendUrl,'','fresh: backend unset (no default URL)');
  assert.equal(ai.showInTools,false,'fresh: tools button hidden');
  assert.equal(M.storage.isReady(),false,'fresh: not ready (disabled, no backend, no token)');
  M.storage.setToken('dev-name:devtoken1234567890abcdef:read');
  assert.equal(M.storage.bearer(),'devtoken1234567890abcdef','bearer = middle part only');
  M.storage.update({ enabled:true, backendUrl:'https://evil.example.com', backendMode:'shared' });
  assert.equal(M.storage.isAllowedBackend('https://evil.example.com'),false,'arbitrary host rejected for shared mode');
  assert.equal(M.storage.isReady(),false,'unlisted host + shared mode => not ready');
  M.storage.update({ backendMode:'custom' });
  assert.equal(M.storage.isReady(),true,'custom mode allows own https backend (owner responsibility)');
  M.storage.update({ backendUrl:'http://insecure.example.com' });
  assert.equal(M.storage.isReady(),false,'plain http rejected in custom mode too');
  M.storage.update({ backendUrl:M.config.ALLOWED_BACKENDS[1], backendMode:'shared' });
  assert.equal(M.storage.isReady(),true,'ready with enabled+allowed backend+token');
  console.log('PASS ai-storage: allowlist enforced, bearer mid-part, readiness');
}

// ── клієнт: формат /ask + помилки ──
{
  const sb=load(...CORE); const M=sb.MTAI;
  sb.settings={ai:{enabled:true,provider:'groq',model:'openai/gpt-oss-120b',backendUrl:'https://w.example.dev'},aiBearerToken:'n:tok1234567890abcdef:read'};
  const seen=[];
  const client=M.createClient({ fetchImpl: async function(url,init){ seen.push({url,init});
      if(seen.length===1) return new Response(JSON.stringify({ok:true,answer:'389',meta:{rounds:2,tool_calls:1}}),{status:200});
      if(seen.length===2) return new Response(JSON.stringify({error:'unauthorized'}),{status:401});
      if(seen.length===3) return new Response(JSON.stringify({error:'ask_failed',code:'HTTP_429',detail:'Rate limit reached. Retry за 20 сек.'}),{status:429});
      if(seen.length===4) return new Response(JSON.stringify({error:'ask_failed',code:'HTTP_500'}),{status:500});
      if(seen.length===5) return new Response(JSON.stringify({error:'ask_failed',code:'HTTP_400',detail:"property 'x' is missing"}),{status:400});
      if(seen.length===6) return new Response(JSON.stringify({error:'ask_not_configured'}),{status:503});
      throw new TypeError('fetch failed');
    }, getConfig: function(){ return { backendUrl:sb.settings.ai.backendUrl, bearer:M.storage.bearer(), provider:sb.settings.ai.provider, model:sb.settings.ai.model }; }, timeoutMs:80 });
  (async function(){
    const ok=await client.ask('Скільки заявок?');
    assert.equal(ok.ok,true); assert.equal(ok.answer,'389');
    assert.equal(seen[0].url,'https://w.example.dev/ask','exact /ask url');
    assert.equal(seen[0].init.method,'POST');
    assert.equal(seen[0].init.headers.Authorization,'Bearer tok1234567890abcdef','mid-token in header');
    assert.deepEqual(JSON.parse(seen[0].init.body),{question:'Скільки заявок?',history:[],provider:'groq',model:'openai/gpt-oss-120b'},'/ask body: question + empty history on first ask');
    const e401=await client.ask('x'); assert.equal(e401.error.kind,'auth');
    const e429=await client.ask('x'); assert.equal(e429.error.kind,'rate_limit'); assert.equal(e429.error.retryAfterSec,20,'retry-after parsed from Ukrainian detail');
    const e500=await client.ask('x'); assert.equal(e500.error.kind,'server');
    const e400=await client.ask('x'); assert.equal(e400.error.kind,'bad_request');
    const e503=await client.ask('x'); assert.equal(e503.error.kind,'not_configured');
    const enet=await client.ask('x'); assert.equal(enet.error.kind,'network');
    // timeout → kind timeout
    const slow=M.createClient({ fetchImpl:function(url,init){ return new Promise(function(resolve,reject){ init.signal.addEventListener('abort',function(){ const e=new Error('aborted'); e.name='AbortError'; reject(e); }); setTimeout(function(){ resolve(new Response('{}',{status:200})); },1000); }); }, getConfig:function(){ return { backendUrl:sb.settings.ai.backendUrl, bearer:'t' }; }, timeoutMs:30 });
    const et=await slow.ask('x'); assert.equal(et.error.kind,'timeout');
    console.log('PASS ai-client: /ask format, 401/429(+Retry-After)/400/500/503/network/timeout');
  })().catch(function(e){ console.error(e); process.exit(1); });
}

// ── рендерер: безпечний DOM, списки, кнопки заявок ──
{
  const sb=load('js/ai/ai-config.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js','js/ai/ai-render.js'); const M=sb.MTAI;
  function fakeDoc(){
    function El(tag){ this.tagName=tag; this.children=[]; this.dataset={}; this._text=''; this.className='';
      this.appendChild=function(c){ this.children.push(c); return c; };
      this.removeChild=function(c){ this.children=this.children.filter(function(x){return x!==c;}); };
      this.addEventListener=function(t,fn){ (this._handlers=this._handlers||{})[t]=fn; }; }
    Object.defineProperty(El.prototype,'textContent',{ set:function(v){ this._text=String(v); this.children=[]; }, get:function(){ return this._text; } });
    return { createElement:function(tag){ return new El(tag); }, createTextNode:function(t){ const e=new El('#text'); e.textContent=t; return e; } };
  }
  function textOf(el){ return (el._text||'')+(el.children||[]).map(textOf).join(''); }
  const doc=fakeDoc(); const renderer=M.createRenderer(doc);
  const box=doc.createElement('div');
  const malicious='Сьогодні 7 ремонтів:\n- вул. Шевченка №<script>alert(1)</script>\n- Заявка #42 готова\n1. пункт';
  renderer.renderAnswer(box,malicious);
  const tags=(function collect(el,acc){ acc.push(el.tagName); (el.children||[]).forEach(function(c){ collect(c,acc); }); return acc; })(box,[]);
  assert.ok(!tags.includes('script'),'script never becomes an element');
  assert.ok(textOf(box).includes('<script>alert(1)</script>'),'script text preserved as plain text');
  const btns=(function collect(el,acc){ (el.children||[]).forEach(function(c){ if(c.tagName==='button')acc.push(c); collect(c,acc); }); return acc; })(box,[]);
  assert.ok(btns.some(function(b){ return b.dataset.ticketId==='42'; }),'#42 → открыть-заявку button');
  const lists=(function collect(el,acc){ (el.children||[]).forEach(function(c){ if(/^[uo]l$/.test(c.tagName))acc.push(c); collect(c,acc); }); return acc; })(box,[]);
  assert.equal(lists.length,2,'bullet + ordered lists built via DOM');
  console.log('PASS ai-render: XSS-safe, lists, ticket-ref buttons');
}

// ── actions: усі WRITE вимкнені, execute відмовляє, openTicket існує ──
{
  const sb=load('js/ai/ai-config.js','js/ai/actions/ai-actions.js','js/ai/actions/ticket-actions.js','js/ai/actions/photo-actions.js'); const M=sb.MTAI;
  const writes=M.actions.list().filter(function(a){ return a.kind==='write'; });
  assert.ok(writes.length>=5,'write intents are registered as scaffolds');
  assert.ok(writes.every(function(a){ return a.enabled===false; }),'every write action is disabled');
  (async function(){
    const r1=await M.actions.execute('ticket.create',{},{});
    assert.equal(r1.reason,'write_disabled','execute refuses write even with confirm UI');
    const r2=await M.actions.execute('unknown',{},{});
    assert.equal(r2.reason,'unknown_action');
    assert.equal(typeof M.actions.openTicket,'function');
    console.log('PASS ai-actions: all WRITE disabled, execute() refuses, read-only openTicket present');
  })().catch(function(e){ console.error(e); process.exit(1); });
}

// ── чат-контролер: 429 cooldown (без авто-ретраїв), retry без дублікатів ──
{
  const sb=load(...CORE.slice(0,6),'js/ai/ai-client.js','js/ai/ai-chat.js'); const M=sb.MTAI;
  let calls=0; const errors=[]; const cooldowns=[]; const userEmits=[];
  const client={ ask: async function(q,h){
    calls++;
    if(calls===1) return { ok:false, error:{ kind:'rate_limit', message:'ліміт', retryAfterSec:1 } };
    return { ok:true, answer:'відповідь після ліміту', meta:{rounds:1,tool_calls:0} };
  } };
  const events=[];
  const chat=M.createChatController({ client, sleep:function(){ return Promise.resolve(); },
    cooldownSec:function(){ return 0.2; },   // тестовий cooldown 200мс
    hooks:{ error:function(e){ errors.push(e); },
            /* rate_limit має власний хук: ОДНА плашка ліміту замість нової
               червоної бульбашки на кожен 429. */
            rate_limit:function(e){ errors.push(e); },
            cooldown:function(c){ cooldowns.push(c); },
            user:function(u){ userEmits.push(u); },
            assistant:function(a){ events.push(a); } } });
  (async function(){
    await chat.send('питання 1');            // 429 → cooldown, БЕЗ авто-ретраю
    assert.equal(calls,1,'429: exactly ONE backend call (no automatic resend)');
    assert.equal(errors.length,1,'rate_limit surfaced via the single rate-limit state');
    assert.equal(cooldowns.length,1,'cooldown emitted');
    assert.ok(chat.cooldownRemainingSec()>0,'cooldown active');
    assert.equal(chat.canRetry(),true,'can retry after failure');
    const blocked=await chat.send('нове питання під час ліміту');
    assert.equal(blocked.skipped,'cooldown','send during cooldown is blocked');
    await new Promise(function(res){ setTimeout(res, 260); }); // чекаємо тестовий cooldown (200мс)
    const r=await chat.retry();              // той самий текст, БЕЗ нового user-emit
    assert.equal(r.ok,true,'retry succeeds after cooldown');
    assert.equal(calls,2,'retry hit the backend');
    assert.equal(userEmits.filter(function(u){ return u==='питання 1'; }).length,1,'NO duplicate user bubble on retry');
    assert.equal(events.filter(function(e){ return e.text; }).length,1,'assistant answer delivered');
    // історія: рівно одне user-повідомлення 'питання 1'
    const hist=chat.history().filter(function(m){ return m.role==='user' && m.text==='питання 1'; });
    assert.equal(hist.length,1,'history intact (no 429 duplicates)');
    assert.ok(chat.cooldownRemainingSec()===0,'cooldown cleared after success-path time');
    await chat.send('   ');                  // порожнє ігнорується
    assert.equal(calls,2,'empty question not sent');
    console.log('PASS ai-chat: 429 cooldown (no auto-retry), blocked send, retry w/o duplicates, history intact');
  })().catch(function(e){ console.error(e); process.exit(1); });
}
