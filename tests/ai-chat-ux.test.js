'use strict';
/* Chat UX контракты: структурированные заявки проходят client.ask ->
   chat controller -> assistant hook; понятные ошибки 429/503 (provider
   disabled); быстрые вопросы по ТЗ. Empty-data/ambiguous формулировки
   пинятся в mcp-тестах системного промпта. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const CORE=['js/ai/ai-config.js','js/ai/providers/provider-registry.js','js/ai/providers/groq.js','js/ai/providers/deepseek.js','js/ai/ai-provider.js','js/ai/ai-storage.js','js/ai/ai-client.js'];

function load(files, fetchImpl, extra){
  const doc={ getElementById(){ return null; }, createElement(){ return { style:{}, setAttribute(){}, appendChild(){} }; }, addEventListener(){} };
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Array, Object, String, Number, RegExp, Error, AbortController, Response, Headers, document:doc, fetch:fetchImpl };
  sandbox.globalThis=sandbox; sandbox.window=undefined;
  Object.assign(sandbox, extra||{});
  for(const f of files) vm.runInContext(read(f),vm.createContext(sandbox),{filename:f});
  return sandbox;
}

(async function run(){
  /* 1) normalizeTickets: фильтр мусора, cap 8 */
  {
    const sb=load(CORE, async function(){ throw new Error('no network'); });
    const norm=sb.MTAI.client.normalizeTickets;
    const out=norm([{id:'7',date:'01.08.2026',address:'A',type:'T'},{id:'bad id!'},{id:42},{},null,{id:'x'.repeat(90),address:'y'.repeat(400)}]);
    assert.equal(out.filter(t=>t).length,3,'keeps valid incl numeric-coerced');
    assert.equal(out[0].id,'7');
    assert.equal(out[out.length-1].id.length,64,'id clipped');
    assert.equal(norm('nope').length,0,'non-array -> empty');
    assert.equal(norm([{id:'a/b'},{id:'a b'}]).length,0,'ids with slashes/spaces rejected');
    console.log('PASS client.normalizeTickets: sanitization + cap');
  }

  /* 2) ask() возвращает tickets из /ask */
  {
    const sb=load(CORE, async function(url,init){
      return new Response(JSON.stringify({ok:true,answer:'Знайдено №123',meta:{rounds:2,tool_calls:1},
        tickets:[{id:'123',date:'01.08.2026',address:'вул. Шевченка, 1',type:'ремонт'},{id:'hack;drop',address:'x'}]}),{status:200});
    });
    sb.settings={ai:{enabled:true,backendUrl:'https://maister-tracker-mcp-dev.mastif1235.workers.dev',backendMode:'shared'},aiBearerToken:'n:tok1234567890abcdef:read'};
    const out=await sb.MTAI.client.ask('знайди 123');
    assert.equal(out.ok,true);
    assert.equal(out.tickets.length,1,'invalid ticket dropped');
    assert.equal(out.tickets[0].id,'123');
    assert.equal(out.tickets[0].address,'вул. Шевченка, 1');
    console.log('PASS ask(): tickets passthrough sanitized');
  }

  /* 3) 429 -> понятное сообщение о лимите */
  {
    /* Worker нормалізує Groq retry-after у payload.retryAfterSeconds —
       саме воно є джерелом істини для countdown (без clamp 20–30 с). */
    const sb=load(CORE, async function(){ return new Response(JSON.stringify({error:'rate_limited', code:'rate_limit', retryAfterSeconds:20}),{status:429,headers:{'Retry-After':'20'}}); });
    sb.settings={ai:{enabled:true,backendUrl:'https://x.example',backendMode:'shared'},aiBearerToken:'n:tok1234567890abcdef:read'};
    const out=await sb.MTAI.client.ask('q');
    assert.equal(out.error.kind,'rate_limit');
    assert.match(out.error.message,/Ліміт/);
    assert.match(out.error.message,/20/,'retry seconds surfaced');
    console.log('PASS 429: понятное сообщение + retry seconds');
  }

  /* 3b) Сумісність зі СТАРИМ Worker'ом: upstream-429 приходив як 502
     HTTP_429 і час був лише в тексті. Має розпізнаватись як rate_limit
     із точними секундами (фікс працює ще до оновлення Worker'а). */
  {
    const sb=load(CORE, async function(){
      return new Response(JSON.stringify({ok:false, error:'ask_failed', code:'HTTP_429',
        detail:'Rate limit reached for model. Please try again in 73s.'}),{status:502});
    });
    sb.settings={ai:{enabled:true,backendUrl:'https://x.example',backendMode:'shared'},aiBearerToken:'n:tok1234567890abcdef:read'};
    const out=await sb.MTAI.client.ask('q');
    assert.equal(out.error.kind,'rate_limit','legacy 502 HTTP_429 is still a rate limit');
    assert.equal(out.error.retryAfterSec,73,'exact wait parsed from the Groq message (no 20-30 guess)');
    console.log('PASS legacy Worker 502 HTTP_429 -> rate_limit with the real 73s');
  }

  /* 3c) 429 БЕЗ будь-якого часу -> НЕ вигадуємо секунди */
  {
    const sb=load(CORE, async function(){ return new Response(JSON.stringify({error:'rate_limited', code:'rate_limit'}),{status:429}); });
    sb.settings={ai:{enabled:true,backendUrl:'https://x.example',backendMode:'shared'},aiBearerToken:'n:tok1234567890abcdef:read'};
    const out=await sb.MTAI.client.ask('q');
    assert.equal(out.error.kind,'rate_limit');
    assert.equal(out.error.retryAfterSec,null,'no invented seconds');
    assert.match(out.error.message,/ще не відновився|пізніше/,'honest message instead of a fake countdown');
    console.log('PASS 429 without timing -> honest message, retryAfterSec=null');
  }

  /* 4) 503 ask_not_configured -> провайдер не включён/ключ не добавлен */
  {
    const sb=load(CORE, async function(){ return new Response(JSON.stringify({error:'ask_not_configured'}),{status:503}); });
    sb.settings={ai:{enabled:true,backendUrl:'https://x.example',backendMode:'shared'},aiBearerToken:'n:tok1234567890abcdef:read'};
    const out=await sb.MTAI.client.ask('q');
    assert.equal(out.error.kind,'not_configured');
    assert.match(out.error.message,/не налаштований|вимкнено/);
    assert.match(out.error.message,/Secret/,'hints at provider setup');
    console.log('PASS 503: provider-disabled guidance');
  }

  /* 5) Быстрые вопросы: 8 монтажных по ТЗ-16 */
  {
    const sb=load(CORE, async function(){ throw new Error('no network'); });
    const q=sb.MTAI.config.quickPrompts();
    assert.equal(q.length,8,'8 quick prompts');
    assert.match(q[0],/сьогодні/);
    assert.match(q[1],/Останні 5 заявок/);
    assert.match(q[2],/за адресою/);
    assert.match(q[3],/Ремонти/);
    assert.match(q[4],/Підключення/);
    assert.match(q[5],/зароблено/);
    assert.match(q[6],/годин/);
    assert.match(q[7],/слабкий сигнал/);
    assert.match(q[5],/\d{4}/,'month+year dynamic');
    console.log('PASS quick prompts: 8 field prompts (today/last5/address/repairs/connections/earnings/hours/weak-signal)');
  }

  /* 5b) chat controller отправляет bounded history в ask */
  {
    const sb=load(['js/ai/ai-config.js','js/ai/ai-chat.js'], null);
    const seen=[];
    const ctrl=sb.MTAI.createChatController({
      client:{ ask:async function(q,h){ seen.push(h||[]); return { ok:true, answer:'ok', meta:{}, tickets:[] }; } }
    });
    await ctrl.send('первый вопрос');
    await ctrl.send('а за август?');
    assert.equal(seen.length,2);
    assert.equal(seen[0].length,0,'first question: no history yet');
    assert.equal(seen[1].length,2,'second question carries previous turn (user + assistant)');
    assert.equal(seen[1][0].role,'user');
    assert.equal(seen[1][0].text,'первый вопрос','history excludes the current question');
    assert.equal(seen[1][1].role,'assistant');
    assert.equal(seen[1][1].text,'ok');
    console.log('PASS chat controller: bounded session history sent to /ask');
  }

  /* 6) chat controller прокидывает tickets в assistant hook */
  {
    const sb=load(['js/ai/ai-config.js','js/ai/ai-chat.js'], null);
    const captured=[];
    const ctrl=sb.MTAI.createChatController({
      client:{ ask:async function(){ return { ok:true, answer:'№123 — 01.08.2026 — вул. Шевченка, 1', meta:{rounds:1,tool_calls:1},
        tickets:[{id:'123',date:'01.08.2026',address:'вул. Шевченка, 1',type:'ремонт'}] }; } },
      hooks:{ assistant:function(out){ captured.push(out); } }
    });
    const res=await ctrl.send('знайди 123');
    assert.equal(res.ok,true);
    assert.equal(captured.length,1);
    assert.equal(captured[0].tickets.length,1,'assistant hook receives tickets');
    assert.equal(captured[0].tickets[0].id,'123');
    const assistantMsg=ctrl.history().filter(function(m){ return m.role==='assistant'; })[0];
    assert.equal(assistantMsg.tickets.length,1,'history stores tickets');
    console.log('PASS chat controller: tickets flow to assistant hook + history');
  }

  console.log('PASS ai-chat-ux: 6/6 blocks');
  process.exit(0);
})().catch(function(e){ console.error(e); process.exit(1); });
