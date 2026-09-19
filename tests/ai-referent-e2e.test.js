'use strict';
/* v91.44 referent e2e (без браузера, через vm): реальна клієнтська цепочка
   ai-client + ai-chat → збереження відповіді → наступний запит.
   TURN 1 «Покажи мне заявку Садовая 19» — звичайний пошук: видимих карток 0,
   але прихований referentTickets зберігається; TURN 2 «Открой мне эту заявку»
   — referent їде на /ask КОНТЕКСТОМ від збереженої відповіді (не інжектом),
   і PWA-дія відкриття отримує реальний id. Окремо: новий явний card-запит
   перебиває старий referent (B, а не A). */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');

function load(...files){
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Array, Object, String, Number, RegExp, Error, AbortController, Response, Headers, fetch };
  sandbox.globalThis=sandbox; sandbox.window=undefined;
  for(const f of files) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),vm.createContext(sandbox),{filename:f});
  return sandbox;
}
function memStorage(){
  const m=new Map();
  return {
    getItem:function(k){ return m.has(k)?m.get(k):null; },
    setItem:function(k,v){ m.set(k,String(v)); },
    removeItem:function(k){ m.delete(k); }
  };
}
const CHAT_MODULES=['js/ai/ai-config.js','js/ai/ai-storage.js','js/ai/ai-client.js','js/ai/ai-chat.js'];
const SETTINGS={ai:{enabled:true,provider:'groq',model:'openai/gpt-oss-120b',backendUrl:'https://w.example.dev'},aiBearerToken:'n:tok1234567890abcdef:read'};
const SAD={id:'t-sad19',date:'12.09.2026',time:'10:20',address:'Миколаївка 1, Вул Садова 19',type:'Ремонт',sum:'900',signal:'-19',note:''};
const ROW_A={id:'t-101',date:'28.08.2026',time:'11:59',address:'Таромське, Футбольна 39',type:'Ремонт',sum:'1600',signal:'-17',note:''};
const ROW_B={id:'t-202',date:'13.09.2026',time:'09:00',address:'Миколаївка 1, Вул Садова 21',type:'Підключення',sum:'1200',signal:'-18',note:''};

// ── TURN 1 → TURN 2: справжня цепочка клієнта ──
{
  const sb=load(...CHAT_MODULES); const M=sb.MTAI;
  sb.settings=JSON.parse(JSON.stringify(SETTINGS));
  const store=memStorage();
  const requests=[];
  const fetchImpl=async function(url,init){
    const body=JSON.parse(init.body); requests.push(body);
    if(requests.length===1){
      /* Звичайний пошук: видимих карток нема, прихований referent — є. */
      return new Response(JSON.stringify({ok:true,answer:'Знайдено 1 заявку: №1, Миколаївка 1, Вул Садова 19.',meta:{},tickets:[],referentTickets:[SAD]}),{status:200});
    }
    return new Response(JSON.stringify({ok:true,answer:'Відкриваю заявку №1.',meta:{intent:'open'},tickets:[SAD],referentTickets:[SAD]}),{status:200});
  };
  const client=M.createClient({fetchImpl:fetchImpl,getConfig:function(){ return {backendUrl:sb.settings.ai.backendUrl,bearer:M.storage.bearer(),provider:sb.settings.ai.provider,model:sb.settings.ai.model}; },timeoutMs:200});
  const assistant=[];
  const chat=M.createChatController({client:client,hooks:{assistant:function(p){ assistant.push(p); }},storage:store});
  (async function(){
    await chat.send('Покажи мне заявку Садовая 19');
    assert.equal(requests.length,1);
    assert.ok(!requests[0].context,'TURN 1: перше питання йде без контексту');
    assert.equal(assistant.length,1);
    assert.equal((assistant[0].tickets||[]).length,0,'TURN 1: visible cards = 0 (звичайний пошук)');
    assert.equal(assistant[0].referentTickets[0].id,'t-sad19','TURN 1: safe referent з реальним id збережено');

    await chat.send('Открой мне эту заявку');
    assert.equal(requests.length,2);
    const ctx2=requests[1].context;
    assert.ok(ctx2 && Array.isArray(ctx2.tickets) && ctx2.tickets[0].id==='t-sad19',
      'TURN 2: referent попередньої відповіді реально передано контекстом (без інжекту в тесті)');
    assert.equal(assistant[1].tickets.length,1,'TURN 2: видима картка');
    assert.equal(assistant[1].tickets[0].id,'t-sad19','TURN 2: картка саме Садова 19');

    const persisted=JSON.parse(store.getItem('mtAiChatHistoryV1'));
    const lastAssistant=persisted.slice().reverse().find(function(m){ return m.role==='assistant'; });
    assert.equal(lastAssistant.referentTickets[0].id,'t-sad19','referent переживає персист для майбутніх turn');
    console.log('PASS referent e2e: search(0 cards)+hidden referent -> open turn gets the real id');
  })().catch(function(e){ console.error(e); process.exit(1); });
}

// ── старий referent A → новий явний card-запит знаходить B: UI отримує B ──
{
  const sb=load(...CHAT_MODULES); const M=sb.MTAI;
  sb.settings=JSON.parse(JSON.stringify(SETTINGS));
  const store=memStorage();
  const requests=[];
  const fetchImpl=async function(url,init){
    const body=JSON.parse(init.body); requests.push(body);
    if(requests.length===1) return new Response(JSON.stringify({ok:true,answer:'Знайдено 1 заявку.',meta:{},tickets:[],referentTickets:[ROW_A]}),{status:200});
    if(requests.length===2) return new Response(JSON.stringify({ok:true,answer:'Карточка №1.',meta:{intent:'cards'},tickets:[ROW_B],referentTickets:[ROW_B]}),{status:200});
    return new Response(JSON.stringify({ok:true,answer:'ok',meta:{}}),{status:200});
  };
  const client=M.createClient({fetchImpl:fetchImpl,getConfig:function(){ return {backendUrl:sb.settings.ai.backendUrl,bearer:M.storage.bearer(),provider:sb.settings.ai.provider,model:sb.settings.ai.model}; },timeoutMs:200});
  const assistant=[];
  const chat=M.createChatController({client:client,hooks:{assistant:function(p){ assistant.push(p); }},storage:store});
  (async function(){
    await chat.send('Покажи мне заявку Садовая 19');           // referent A
    await chat.send('Дай карточку этой заявки');               // server знаходить B
    assert.equal(requests[1].context.tickets[0].id,'t-101','turn 2 ніс старий referent A');
    assert.equal(assistant[1].tickets[0].id,'t-202','UI отримав B, а не A');
    await chat.send('ще одне питання');
    assert.equal(requests[2].context.tickets[0].id,'t-202','наступний turn несе B — старий A витіснено');
    console.log('PASS referent e2e: new explicit card result B replaces old referent A');
  })().catch(function(e){ console.error(e); process.exit(1); });
}

// ── реальний id доходить до PWA open action ──
{
  const sb=load('js/ai/ai-config.js','js/ai/actions/ai-actions.js'); const M=sb.MTAI;
  sb.tickets=[{id:'t-sad19',city:'Миколаївка 1',street:'Вул Садова',house:'19',date:'12.09.2026'}];
  let navigated=null; sb.goToTicketProfile=function(id){ navigated=id; };
  let pushed=null; sb.appNavigationPush=function(name){ pushed=name; };
  sb.showToast=function(){};
  (async function(){
    const ok=await M.actions.openTicket('t-sad19');
    assert.equal(ok,true,'openTicket succeeds for the referent id');
    assert.equal(navigated,'t-sad19','real id reaches the existing PWA navigation');
    assert.equal(pushed,'ai-return','return-to-AI frame pushed');
    console.log('PASS referent e2e: open action navigates by the real id');
  })().catch(function(e){ console.error(e); process.exit(1); });
}

// ── статична зв'язка нового e2e-файла не потрібна; перевірка контракту відповіді ──
{
  const sb=load('js/ai/ai-config.js','js/ai/ai-storage.js','js/ai/ai-client.js'); const M=sb.MTAI;
  sb.settings=JSON.parse(JSON.stringify(SETTINGS));
  const client=M.createClient({fetchImpl:async function(){ return new Response(JSON.stringify({ok:true,answer:'a',meta:{},tickets:[],referentTickets:[SAD,{id:'<bad!>'}]}),{status:200}); },getConfig:function(){ return {backendUrl:sb.settings.ai.backendUrl,bearer:M.storage.bearer(),provider:sb.settings.ai.provider,model:sb.settings.ai.model}; },timeoutMs:200});
  (async function(){
    const out=await client.ask('q');
    assert.equal(out.referentTickets.length,1,'client sanitizes referentTickets like tickets');
    assert.equal(out.referentTickets[0].id,'t-sad19');
    console.log('PASS referent e2e: client referent projection is strict/safe');
  })().catch(function(e){ console.error(e); process.exit(1); });
}

// ── privacy: старий persisted referent із note/phone НЕ їде у context ──
{
  const sb=load(...CHAT_MODULES); const M=sb.MTAI;
  sb.settings=JSON.parse(JSON.stringify(SETTINGS));
  const store=memStorage();
  /* Симулюємо СТАРУ збережену сесію, де referent ще містив приватні поля. */
  store.setItem('mtAiChatHistoryV1', JSON.stringify([
    {role:'user', text:'Покажи мне заявку Лісна 74', ts:1},
    {role:'assistant', text:'Знайдено 1 заявку.', ts:2, tickets:[],
     referentTickets:[{id:'t-priv1', date:'14.09.2026', time:'12:00', address:'Дніпро, Лісна 74', type:'Ремонт', sum:'750', signal:'-24', note:'секретна нотатка', phone:'0671234567'}]}
  ]));
  const requests=[];
  const fetchImpl=async function(url,init){
    const body=JSON.parse(init.body); requests.push(body);
    return new Response(JSON.stringify({ok:true,answer:'ok',meta:{}}),{status:200});
  };
  const client=M.createClient({fetchImpl:fetchImpl,getConfig:function(){ return {backendUrl:sb.settings.ai.backendUrl,bearer:M.storage.bearer(),provider:sb.settings.ai.provider,model:sb.settings.ai.model}; },timeoutMs:200});
  const chat=M.createChatController({client:client,hooks:{},storage:store});
  (async function(){
    await chat.send('Який там був сигнал?');
    assert.equal(requests.length,1);
    const ctx=requests[0].context;
    assert.ok(ctx && ctx.tickets[0].id==='t-priv1','old referent still resolves');
    const ctxJson=JSON.stringify(ctx);
    assert.ok(!ctxJson.includes('note') && !ctxJson.includes('секретна') && !ctxJson.includes('0671234567'),
      'client whitelist strips note/phone from the outgoing context even from old history');
    assert.deepEqual(Object.keys(ctx.tickets[0]).sort(), ['address','date','id','signal','sum','time','type'],
      'outgoing context is the minimal safe set');
    console.log('PASS referent privacy: old persisted referent never leaks note/phone into /ask context');
  })().catch(function(e){ console.error(e); process.exit(1); });
}

// ── privacy: клієнт приймає referentTickets БЕЗ note навіть від старого Worker ──
{
  const sb=load('js/ai/ai-config.js','js/ai/ai-storage.js','js/ai/ai-client.js'); const M=sb.MTAI;
  sb.settings=JSON.parse(JSON.stringify(SETTINGS));
  const client=M.createClient({fetchImpl:async function(){ return new Response(JSON.stringify({ok:true,answer:'a',meta:{},tickets:[],referentTickets:[{id:'t-priv1',date:'14.09.2026',address:'Дніпро, Лісна 74',note:'секретна',phone:'0671234567',clientName:'Іван',macAddress:'AA:BB'}]}),{status:200}); },getConfig:function(){ return {backendUrl:sb.settings.ai.backendUrl,bearer:M.storage.bearer(),provider:sb.settings.ai.provider,model:sb.settings.ai.model}; },timeoutMs:200});
  (async function(){
    const out=await client.ask('q');
    assert.equal(out.referentTickets[0].id,'t-priv1');
    const s=JSON.stringify(out.referentTickets);
    assert.ok(!s.includes('секретна') && !s.includes('0671234567') && !s.includes('Іван') && !s.includes('AA:BB'), 'client-side referent projection drops private fields');
    assert.ok(!('note' in out.referentTickets[0]), 'no note key at all');
    console.log('PASS referent privacy: client normalizer enforces the minimal set');
  })().catch(function(e){ console.error(e); process.exit(1); });
}
