'use strict';
/* v91.44 smart search, клієнтська частина (без браузера, через vm):
   - /ask тепер передає референтний контекст (заявки попередньої відповіді)
     і лишає тіло першого запиту незмінним;
   - локальні мережеві точки (ФОБ/муфта/вузол) шукаються ТІЛЬКИ на пристрої:
     фільтр за типом/текстом/періодом, дія «На карті» через наявний
     toolsFocusNetworkPoint, координати не приходять від моделі;
   - статичне підключення нового модуля (index.html + sw.js precache). */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');

function load(...files){
  const sandbox={ console, setTimeout, clearTimeout, Promise, Date, Math, JSON, Array, Object, String, Number, RegExp, Error, AbortController, Response, Headers, fetch };
  sandbox.globalThis=sandbox; sandbox.window=undefined;
  for(const f of files) vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),vm.createContext(sandbox),{filename:f});
  return sandbox;
}

const CORE=['js/ai/ai-config.js','js/ai/ai-storage.js','js/ai/ai-client.js'];

// ── клієнт: референтний контекст + локальний запит ──
{
  const sb=load(...CORE); const M=sb.MTAI;
  sb.settings={ai:{enabled:true,provider:'groq',model:'openai/gpt-oss-120b',backendUrl:'https://w.example.dev'},aiBearerToken:'n:tok1234567890abcdef:read'};
  const seen=[];
  const client=M.createClient({ fetchImpl: async function(url,init){ seen.push({url,init});
      if(seen.length===1) return new Response(JSON.stringify({ok:true,answer:'1',meta:{}}),{status:200});
      if(seen.length===2) return new Response(JSON.stringify({ok:true,answer:'2',meta:{},tickets:[{id:'t-101',date:'28.08.2026',time:'11:59',address:'Таромське, Футбольна 39',type:'Ремонт',sum:'1600'}]}),{status:200});
      return new Response(JSON.stringify({ok:true,answer:'3',meta:{},localQuery:{kind:'network_points',type:'FOB',text:'ФОБ в посадке на Таромском',date_from:'01.08.2026',date_to:'31.08.2026',period_note:'розширено ±3 дні',evil:'<script>'}}),{status:200});
    }, getConfig: function(){ return { backendUrl:sb.settings.ai.backendUrl, bearer:M.storage.bearer(), provider:sb.settings.ai.provider, model:sb.settings.ai.model }; }, timeoutMs:80 });
  (async function(){
    // Перше питання: тіло запиту БЕЗ контексту (сумісність байт-в-байт)
    await client.ask('Скільки заявок?');
    assert.deepEqual(JSON.parse(seen[0].init.body),{question:'Скільки заявок?',history:[],provider:'groq',model:'openai/gpt-oss-120b'},'first ask keeps the legacy body shape');
    // Друге питання з контекстом попередньої відповіді
    await client.ask('Відкрий цю заявку', [], {tickets:[{id:'t-101',date:'28.08.2026',address:'Таромське, Футбольна 39'},{id:'<bad id!>'}]});
    const body2=JSON.parse(seen[1].init.body);
    assert.ok(body2.context && Array.isArray(body2.context.tickets),'context is attached when the previous answer had tickets');
    assert.equal(body2.context.tickets.length,1,'invalid ids are dropped');
    assert.equal(body2.context.tickets[0].id,'t-101');
    // Третє: localQuery санітизується (лише відомі поля, дати за форматом)
    const out3=await client.ask('Покажи цей ФОБ на карті');
    assert.ok(out3.localQuery,'localQuery travels to the PWA');
    assert.equal(out3.localQuery.kind,'network_points');
    assert.equal(out3.localQuery.type,'FOB');
    assert.equal(out3.localQuery.date_from,'01.08.2026');
    assert.equal(out3.localQuery.evil,undefined,'unknown fields dropped');
    assert.equal(client.sanitizeLocalQuery({kind:'other'}),null);
    assert.equal(client.sanitizeLocalQuery({kind:'network_points',date_from:'2026-08-01'}).date_from,null,'non DD.MM.YYYY dates rejected');
    console.log('PASS ai-client: referent context + sanitized localQuery');
  })().catch(function(e){ console.error(e); process.exit(1); });
}

// ── локальні мережеві точки: детермінований фільтр ──
{
  const sb=load('js/ai/ai-config.js','js/ai/ai-local-actions.js'); const M=sb.MTAI;
  const points=[
    {id:'np-1',type:'FOB',name:'ФОБ на посадці',city:'Таромське',street:'',house:'',note:'посадка біля лісу',createdAt:'2026-08-12T10:00:00.000Z',updatedAt:'2026-08-12T10:00:00.000Z'},
    {id:'np-2',type:'Муфта',name:'',city:'Таромське',street:'Мостова',house:'25',note:'',createdAt:'2026-07-01T09:00:00.000Z',updatedAt:'2026-07-01T09:00:00.000Z'},
    {id:'np-3',type:'FOB',name:'ФОБ Садова',city:'Миколаївка 1',street:'Садова',house:'3',note:'',createdAt:'2026-09-10T09:00:00.000Z',updatedAt:'2026-09-10T09:00:00.000Z'}
  ];
  const fob=M.localActions.filterPoints(points,{kind:'network_points',type:'FOB',text:'ФОБ був где-то в посадке на Таромском примерно в прошлом месяце',date_from:'01.08.2026',date_to:'31.08.2026'});
  assert.deepEqual(Array.from(fob).map(function(p){ return p.id; }),['np-1'],'type + text clue «посадка» + period; stop-words ignored');
  const splice=M.localActions.filterPoints(points,{type:'Муфта',text:'Какие муфты на Мостовой?'});
  assert.deepEqual(Array.from(splice).map(function(p){ return p.id; }),['np-2']);
  const all=M.localActions.filterPoints(points,{text:''});
  assert.equal(all.length,3,'no filters -> everything');
  const none=M.localActions.filterPoints(points,{type:'Вузол'});
  assert.equal(none.length,0,'absent type -> honest empty result');
  const taromske=M.localActions.filterPoints(points,{text:'таромське'});
  assert.equal(taromske.length,2);

  // searchNetworkPoints бере дані з локальних глобалів застосунку
  sb.toolsNetworkPoints=points;
  sb.MTToolsCore={
    sanitizeNetworkPoints:function(list){ return list; },
    networkPointAddress:function(p){ return [p.city,p.street,p.house].filter(Boolean).join(', '); },
    sortNewestFirst:function(list){ return list.slice().sort(function(a,b){ return Date.parse(b.createdAt)-Date.parse(a.createdAt); }); }
  };
  const found=M.localActions.searchNetworkPoints({type:'FOB',date_from:'01.09.2026',date_to:'30.09.2026'});
  assert.equal(found.length,1);
  assert.equal(found[0].id,'np-3');
  assert.ok(!JSON.stringify(found).includes('lat') && !JSON.stringify(found).includes('lng'),'projection carries no coordinates');

  let focused=null;
  sb.toolsFocusNetworkPoint=function(id){ focused=id; };
  assert.equal(M.localActions.focusNetworkPoint('np-3'),true);
  assert.equal(focused,'np-3');
  assert.equal(M.localActions.focusNetworkPoint(''),false);
  console.log('PASS ai-local-actions: type/text/period filter + safe map focus');
}

// ── рендер результату локального пошуку (фейковий DOM) ──
{
  const sb=load('js/ai/ai-config.js','js/ai/ai-local-actions.js'); const M=sb.MTAI;
  sb.toolsNetworkPoints=[{id:'np-1',type:'FOB',name:'ФОБ',city:'Таромське',note:'посадка',createdAt:'2026-08-12T10:00:00.000Z',updatedAt:'2026-08-12T10:00:00.000Z'}];
  sb.MTToolsCore={sanitizeNetworkPoints:function(l){return l;},networkPointAddress:function(p){return p.city;},sortNewestFirst:function(l){return l;}};
  function El(tag){ this.tagName=tag; this.children=[]; this.attributes={}; this.style={}; this.className='';
    this.appendChild=function(c){ this.children.push(c); return c; };
    this.setAttribute=function(k,v){ this.attributes[k]=v; };
    this.addEventListener=function(t,fn){ (this.handlers=this.handlers||{})[t]=fn; }; }
  Object.defineProperty(El.prototype,'textContent',{set:function(v){ this._text=String(v); },get:function(){ return this._text||''; }});
  const doc={createElement:function(t){ return new El(t); }};
  const container=new El('div'); container.ownerDocument=doc;
  const rendered=M.localActions.renderResults(container,{kind:'network_points',type:'FOB',text:'фоб посадка таромське',date_from:'01.08.2026',date_to:'31.08.2026'});
  assert.equal(rendered,1);
  const flat=(function collect(el,acc){ (el.children||[]).forEach(function(c){ acc.push(c); collect(c,acc); }); return acc; })(container,[]);
  const btns=flat.filter(function(el){ return el.tagName==='button'; });
  assert.equal(btns.length,1,'one map action button');
  assert.match(btns[0].textContent,/Показати на карті/);
  let focused=null; sb.toolsFocusNetworkPoint=function(id){ focused=id; };
  btns[0].handlers.click();
  assert.equal(focused,'np-1','button focuses the local point through the existing mechanism');
  // порожній результат — чесне повідомлення, без вигаданих точок
  const empty=new El('div'); empty.ownerDocument=doc;
  const count=M.localActions.renderResults(empty,{kind:'network_points',type:'Вузол',text:'вузол'});
  assert.equal(count,0);
  const texts=(function collect(el,acc){ acc.push(el.textContent||''); (el.children||[]).forEach(function(c){ collect(c,acc); }); return acc; })(empty,[]).join(' ');
  assert.match(texts,/нічого не знайдено/);
  console.log('PASS ai-local-actions: chat rendering + honest empty state');
}

// ── статичне підключення нового модуля ──
{
  const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const swSource=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  const chatSource=fs.readFileSync(path.join(root,'js','ai','ai-chat.js'),'utf8');
  const uiSource=fs.readFileSync(path.join(root,'js','ai','ai-ui.js'),'utf8');
  assert.ok(indexHtml.includes('js/ai/ai-local-actions.js'),'module is loaded by index.html');
  assert.ok(indexHtml.indexOf('ai-result-cards.js') < indexHtml.indexOf('ai-local-actions.js') && indexHtml.indexOf('ai-local-actions.js') < indexHtml.indexOf('ai-ui.js'),'load order: after cards, before ui');
  assert.ok(swSource.includes('./js/ai/ai-local-actions.js'),'module is precached by the service worker');
  assert.match(chatSource,/client\.ask\(question, history, \{ tickets: referent, queryContext: followUpQueryContext \}\)/,'chat passes referent + v91.46 structured follow-up context');
  assert.match(uiSource,/MTAI\.localActions\.renderResults\(b, out\.localQuery\)/,'UI executes local network queries');
  console.log('PASS static wiring: local actions module loaded, precached and called');
}
