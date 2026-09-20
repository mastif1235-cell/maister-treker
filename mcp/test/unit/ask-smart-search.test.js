/* Unit tests for the v91.44 /ask intelligence layer: card/open/map intent
   detection, referent persistence across turns, local network-point query,
   query_tickets projection shape, privacy of tool payloads and the response
   granularity contract (UUID-free text numbering, no coordinates). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAskOrchestrator, cardIntentFor, normalizeContextTickets,
  buildLocalNetworkQuery, projectTicketsForClient, ASK_SYSTEM_PROMPT
} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {dateHintsLine} from '../../src/ask/date-resolver.js';

function scriptedGroq(steps){
  let i = 0;
  return {
    calls: 0,
    chat: async function(){
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      this.calls++;
      return typeof step === 'function' ? step() : step;
    }
  };
}

function toolResponse(name, argsRaw){
  return {ok:true, content:'', toolCalls:[{id:'call_x', name, argsRaw}],
    assistantMessage:{role:'assistant', content:'', tool_calls:[{id:'call_x', type:'function', function:{name, arguments:argsRaw}}]}};
}

function finalResponse(text){ return {ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}}; }

function queryToolsStub(rows){
  return {
    query_tickets: async function(){
      return {ok:true, data:{tool:'query_tickets', mode:'list', matched:rows.length, total_matched:rows.length, tickets:rows, resolved_filters:{}, coverage:{}}};
    },
    list_tickets: async function(){ return {ok:true, data:{tickets:rows, total_matched:rows.length}}; }
  };
}

const ROW_A = {ord:1, id:'t-101', date:'28.08.2026', time:'11:59', city:'Таромське', street:'Вул Футбольна', house:'39',
  address:'Таромське, Вул Футбольна 39', type:'Ремонт', sum:1600, payment:'Готівка', signal:'-17', has_geo:true,
  match_reasons:['місто:структурне', 'роутер:обладнання']};

/* ---------- intent detection ---------- */

test('card/open/map intents: production phrases detected, search phrases not', () => {
  assert.equal(cardIntentFor('Дай мне карточку этой заявки'), 'cards');
  assert.equal(cardIntentFor('Открой мне эту заявку'), 'open');
  assert.equal(cardIntentFor('Відкрий цю заявку'), 'open');
  assert.equal(cardIntentFor('Мне нужно чтобы я в неё перешёл'), 'open');
  assert.equal(cardIntentFor('покажи її на карті'), 'map');
  assert.equal(cardIntentFor('Покажи эту заявку на карте'), 'map');
  assert.equal(cardIntentFor('На карті?'), 'map');
  assert.equal(cardIntentFor('Покажи заявки за август'), null, 'plain search is not a card intent');
  assert.equal(cardIntentFor('Скільки роутерів я поставив?'), null);
  assert.equal(cardIntentFor('Які будинки на Садовій?'), null);
});

test('context tickets normalization is a strict safe projection', () => {
  const ctx = normalizeContextTickets([
    {id:'t-101', date:'28.08.2026', time:'11:59', address:'Таромське, Футбольна 39', type:'Ремонт', sum:1600},
    {id:'<script>evil</script>', date:'x'},
    {id:'  t-102  ', date:'29.08.2026'}
  ]);
  assert.equal(ctx.length, 2);
  assert.equal(ctx[0].id, 't-101');
  assert.equal(ctx[1].id, 't-102');
});

/* ---------- referent persistence: «Открой эту заявку» ---------- */

test('explicit open request after a previous result: referent retained, real open action returned', async () => {
  /* The model makes NO tool call this turn; the previous answer's tickets
     arrive as structured context and become the card projection. */
  const groq = scriptedGroq([finalResponse('Відкриваю картку заявки за 28.08.2026 (Таромське, Футбольна 39).')]);
  const orch = createAskOrchestrator({groq, tools:queryToolsStub([]), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('Открой мне эту заявку', {contextTickets:[ROW_A]});
  assert.equal(outcome.ok, true);
  assert.equal(outcome.meta.intent, 'open');
  assert.equal(outcome.tickets.length, 1);
  assert.equal(outcome.tickets[0].id, 't-101', 'structured ticket id reaches the PWA for its validated open action');
  assert.ok(outcome.tickets[0].address.includes('Футбольна'));
});

test('explicit card request after tool search returns structured card metadata', async () => {
  const groq = scriptedGroq([
    toolResponse('query_tickets', '{"mode":"list","city":"Таромське"}'),
    finalResponse('Ось заявка.')
  ]);
  const orch = createAskOrchestrator({groq, tools:queryToolsStub([ROW_A]), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('Покажи заявку Садовая 19. Дай карточку', {});
  assert.equal(outcome.ok, true);
  assert.equal(outcome.meta.intent, 'cards');
  assert.equal(outcome.tickets.length, 1);
  assert.equal(outcome.tickets[0].id, 't-101');
});

test('ordinary search/count questions never produce cards', async () => {
  const groq = scriptedGroq([
    toolResponse('query_tickets', '{"mode":"count","items":[{"text":"роутер"}]}'),
    finalResponse('У серпні поставлено 1 роутер по 1500 грн.')
  ]);
  const orch = createAskOrchestrator({groq, tools:queryToolsStub([ROW_A]), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('Скільки роутерів по 1500 я поставив у серпні?', {});
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.tickets, []);
});

/* ---------- referent hint reaches the model ---------- */

test('previous-answer tickets are hinted with ordinals so «картку другої» resolves', async () => {
  let seenMessages = null;
  const groq = {chat: async function(messages){ seenMessages = messages; return finalResponse('Ось картка другої заявки.'); }};
  const orch = createAskOrchestrator({groq, tools:queryToolsStub([]), toolDefs:TOOL_DEFINITIONS});
  await orch.handle('Дай картку другої', {contextTickets:[
    {id:'t-1', date:'01.08.2026', address:'Адреса 1'},
    {id:'t-2', date:'02.08.2026', address:'Адреса 2'}
  ]});
  const system = seenMessages[0].content;
  assert.ok(system.includes('[id:t-1]') && system.includes('[id:t-2]'));
  assert.ok(system.includes('1)') && system.includes('2)'));
});

/* ---------- query_tickets projection ---------- */

test('query_tickets rows reach the model compact: ord numbering, has_geo boolean, no geoLink/coordinates', async () => {
  let toolText = null;
  const groq = {
    calls:0,
    chat: async function(messages){
      const lastTool = messages.filter(function(m){ return m.role === 'tool'; }).pop();
      if(lastTool) toolText = lastTool.content;
      if(this.calls++ === 0) return toolResponse('query_tickets', '{"mode":"list"}');
      return finalResponse('Знайдено 1 заявку.');
    }
  };
  const orch = createAskOrchestrator({groq, tools:queryToolsStub([Object.assign({}, ROW_A, {geoLink:'https://maps.google.com/?q=48.464,35.046'})]), toolDefs:TOOL_DEFINITIONS});
  await orch.handle('Где ставил роутер и менял коннектор?', {});
  assert.ok(toolText, 'tool result was fed back');
  const payload = JSON.parse(toolText);
  assert.equal(payload.result.tickets[0].ord, 1);
  assert.equal(payload.result.tickets[0].has_geo, true);
  assert.ok(!toolText.includes('geoLink'));
  assert.ok(!toolText.includes('48.464'), 'coordinates never travel to the model');
  assert.ok(!toolText.includes('note'), 'no private notes in query rows');
});

/* ---------- response style contract ---------- */

test('system prompt enforces UUID-free text, granularity and standalone queries', () => {
  assert.match(ASK_SYSTEM_PROMPT, /НІКОЛИ не показуй у тексті/, 'no technical ids in ordinary answers');
  assert.match(ASK_SYSTEM_PROMPT, /порядковий номер/, 'numbering 1, 2, 3 instead of ids');
  assert.match(ASK_SYSTEM_PROMPT, /НЕ успадковує сигнал/, 'standalone query must not inherit the previous signal filter');
  assert.match(ASK_SYSTEM_PROMPT, /Миколаївка 1/, 'the production regression is spelled out');
  assert.match(ASK_SYSTEM_PROMPT, /Не відповідай глибше за питання/, 'granularity contract');
  assert.match(ASK_SYSTEM_PROMPT, /збігається зі зміною цього дня/, 'honest coworker wording');
  assert.match(ASK_SYSTEM_PROMPT, /НІКОЛИ не відповідай, що відкрити неможливо/, 'open-ticket is a supported READ action');
  assert.match(ASK_SYSTEM_PROMPT, /matched\/total_matched\/item_totals/, 'authoritative metadata over row counting');
});

/* ---------- local network points (FOB/splice/node) ---------- */

test('FOB/splice questions produce a deterministic local search request', () => {
  const now = new Date(2026, 8, 19);
  const q = buildLocalNetworkQuery('ФОБ був где-то в посадке на Таромском примерно в прошлом месяце — найди', now);
  assert.ok(q);
  assert.equal(q.kind, 'network_points');
  assert.equal(q.type, 'FOB');
  assert.equal(q.date_from, '01.08.2026');
  assert.equal(q.date_to, '31.08.2026');
  assert.ok(q.text.includes('посадке'));
  const splice = buildLocalNetworkQuery('Какие муфты на Мостовой?', now);
  assert.equal(splice.type, 'Муфта');
  const none = buildLocalNetworkQuery('Скільки роутерів поставив?', now);
  assert.equal(none, null);
  const planted = buildLocalNetworkQuery('Що я робив в посадці?', now);
  assert.ok(planted, '«посадка» alone is a network-point clue');
});

test('localQuery travels in the orchestrator outcome for network questions only', async () => {
  const groq = scriptedGroq([finalResponse('Застосунок виконав локальний пошук точок.')]);
  const orch = createAskOrchestrator({groq, tools:queryToolsStub([]), toolDefs:TOOL_DEFINITIONS});
  const fob = await orch.handle('Покажи этот ФОБ на карте', {now: new Date(2026, 8, 19)});
  assert.ok(fob.localQuery);
  assert.equal(fob.localQuery.type, 'FOB');
  const plain = await orch.handle('Скільки заявок за серпень?', {});
  assert.equal(plain.localQuery, undefined);
});

/* ---------- privacy of the model-facing payload ---------- */

test('private raw note never reaches the model through smart search', async () => {
  const seen = [];
  const groq = {
    chat: async function(messages){
      seen.push(messages.map(function(m){ return String(m.content || ''); }).join('\n'));
      if(seen.length === 1) return toolResponse('query_tickets', '{"mode":"list","city":"Таромське"}');
      return finalResponse('Знайдено.');
    }
  };
  const tools = {
    query_tickets: async function(){
      return {ok:true, data:{tool:'query_tickets', mode:'list', matched:1, total_matched:1, tickets:[ROW_A], resolved_filters:{}, coverage:{}}};
    }
  };
  const orch = createAskOrchestrator({groq, tools, toolDefs:TOOL_DEFINITIONS});
  await orch.handle('Що робили в Таромському?', {});
  const all = seen.join('\n');
  assert.ok(!all.includes('PRIVATE_MASTER_NOTE'));
  assert.ok(!all.includes('0671234567'));
});

/* ---------- approximate periods reach the prompt ---------- */

test('approximate period phrases are pre-computed and documented for the model', () => {
  const now = new Date(2026, 8, 19);
  const hints = dateHintsLine('примерно в конце августа ставил роутер', now);
  assert.ok(hints.includes('18.08.2026') && hints.includes('03.09.2026'), 'expanded window is exposed');
  assert.ok(hints.includes('розширено'), 'expansion is documented, not silent');
  const plain = dateHintsLine('за серпень', now);
  assert.ok(plain.includes('01.08.2026') && plain.includes('31.08.2026'));
});

test('projectTicketsForClient keeps the safe card shape', () => {
  const cards = projectTicketsForClient([ROW_A]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, 't-101');
  assert.ok(!('match_reasons' in cards[0]));
});

/* ---------- real two-turn referent chain (server side) ---------- */

const ROW_SAD = {ord:1, id:'t-sad19', date:'12.09.2026', time:'10:20', city:'Миколаївка 1', street:'Вул Садова', house:'19',
  address:'Миколаївка 1, Вул Садова 19', type:'Ремонт', sum:900, payment:'Готівка', signal:'-19', has_geo:false,
  match_reasons:['вулиця:структурна']};
const ROW_B = {ord:1, id:'t-202', date:'13.09.2026', time:'09:00', city:'Миколаївка 1', street:'Вул Садова', house:'21',
  address:'Миколаївка 1, Вул Садова 21', type:'Підключення', sum:1200, payment:'Картка', signal:'-18', has_geo:true,
  match_reasons:['вулиця:структурна']};

test('referent chain: ordinary search stores hidden referent, next open turn resolves the real id', async () => {
  /* TURN 1 — ordinary search: the model runs query_tickets; NO card intent. */
  const groq1 = scriptedGroq([
    toolResponse('query_tickets', '{"mode":"list","street":"Садова","house":"19"}'),
    finalResponse('Знайдено 1 заявку: №1, Миколаївка 1, Вул Садова 19.')
  ]);
  const orch1 = createAskOrchestrator({groq:groq1, tools:queryToolsStub([ROW_SAD]), toolDefs:TOOL_DEFINITIONS});
  const turn1 = await orch1.handle('Покажи мне заявку Садовая 19', {});
  assert.equal(turn1.ok, true);
  assert.equal(turn1.meta.intent, undefined, 'address-targeted search is NOT an open intent');
  assert.equal(turn1.tickets.length, 0, 'ordinary search renders no visible cards (UX rule)');
  assert.equal(turn1.referentTickets.length, 1, 'hidden referent stored for the next turn');
  assert.equal(turn1.referentTickets[0].id, 't-sad19', 'referent carries the real id from the tool result');
  const refJson = JSON.stringify(turn1.referentTickets);
  for(const forbidden of ['phone', 'geoLink', 'geoLat', 'geoLng', 'mac', 'contract', 'password']){
    assert.ok(!refJson.includes(forbidden), 'referent carries no ' + forbidden);
  }

  /* TURN 2 — the client sends back EXACTLY what turn1 returned (as ai-client
     does with payload.referentTickets); no manual ROW injection. */
  const groq2 = scriptedGroq([finalResponse('Відкриваю заявку №1.')]);
  const orch2 = createAskOrchestrator({groq:groq2, tools:queryToolsStub([]), toolDefs:TOOL_DEFINITIONS});
  const turn2 = await orch2.handle('Открой мне эту заявку', {contextTickets:turn1.referentTickets});
  assert.equal(turn2.ok, true);
  assert.equal(turn2.meta.intent, 'open');
  assert.equal(turn2.tickets.length, 1, 'visible card on the explicit open turn');
  assert.equal(turn2.tickets[0].id, 't-sad19', 'card carries the real id for the PWA open action');
  assert.equal(turn2.tickets[0].address, 'Миколаївка 1, Вул Садова 19');
  assert.equal(turn2.referentTickets[0].id, 't-sad19');
});

test('explicit card turn with a NEW query: fresh result wins over the old referent', async () => {
  /* Old referent A exists; the explicit card turn runs a NEW query that finds B.
     The UI must receive B only — never A+B under the 8-cap. */
  const groq = scriptedGroq([
    toolResponse('query_tickets', '{"mode":"list","street":"Садова","house":"21"}'),
    finalResponse('Карточка знайденої заявки №1.')
  ]);
  const orch = createAskOrchestrator({groq, tools:queryToolsStub([ROW_B]), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('Дай карточку этой заявки', {contextTickets:[ROW_A]});
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.tickets.map(function(t){ return t.id; }), ['t-202'], 'new result B wins, old referent A dropped');
  assert.deepEqual(outcome.referentTickets.map(function(t){ return t.id; }), ['t-202'], 'next-turn referent is B too');
});

test('open intent requires anaphora: address-targeted «покажи заявку X» stays an ordinary search', () => {
  assert.equal(cardIntentFor('Покажи мне заявку Садовая 19'), null, 'search with own target');
  assert.equal(cardIntentFor('Покажи заявку Садова 19'), null);
  assert.equal(cardIntentFor('Открой мне эту заявку'), 'open', 'anaphoric reference still opens');
  assert.equal(cardIntentFor('Відкрий цю заявку'), 'open');
  assert.equal(cardIntentFor('открой последнюю заявку'), 'open');
  assert.equal(cardIntentFor('Покажи заявку Садовая 19. Дай карточку'), 'cards', 'explicit card word still wins');
});

/* ---------- privacy referent regression ---------- */

test('privacy referent: hidden referentTickets carries ONLY the minimal safe set', async () => {
  const ROW_PRIV = {ord:1, id:'t-priv1', date:'14.09.2026', time:'12:00', city:'Дніпро', street:'Лісна', house:'74',
    address:'Дніпро, Лісна 74', type:'Ремонт', sum:750, payment:'Готівка', signal:'-24', has_geo:true,
    note:'секретна нотатка', abonentNote:'абонент пароль', phone:'0671234567', extraPhones:['0991112233'],
    clientName:'Іван Петренко', macAddress:'AA:BB:CC:DD:EE:FF', contractNumber:'контракт-77',
    geoLink:'https://maps.google.com/?q=48.4,35.0', geoLat:48.4, geoLng:35.0,
    equipment:[{label:'Роутер', price:1500, qty:1, total:1500}], match_reasons:[]};
  const groq = scriptedGroq([toolResponse('query_tickets', '{"mode":"list"}'), finalResponse('Знайдено 1 заявку: №1.')]);
  const orch = createAskOrchestrator({groq, tools:queryToolsStub([ROW_PRIV]), toolDefs:TOOL_DEFINITIONS});
  const out = await orch.handle('Покажи мне заявку Лісна 74', {});
  assert.equal(out.tickets.length, 0, 'ordinary search: no visible cards');
  assert.equal(out.referentTickets.length, 1);
  const ref = out.referentTickets[0];
  assert.deepEqual(Object.keys(ref).sort(), ['address','date','id','signal','sum','time','type'],
    'referent is the explicit minimal projection (no note/phone/geo/client)');
  const s = JSON.stringify(out.referentTickets);
  for(const bad of ['секретна','пароль','0671234567','AA:BB','контракт-77','maps.google','48.4','Петренко','Роутер']){
    assert.ok(!s.includes(bad), 'referent carries no ' + bad);
  }
});

/* ---------- open vs search intent regressions ---------- */

test('intent trio: show=search, navigation verb=open with fresh READ, anaphora=open via referent', async () => {
  /* 1) «Покажи заявку Садовая 19» — ordinary search, visible cards = 0. */
  const g1 = scriptedGroq([toolResponse('query_tickets', '{"mode":"list","street":"Садова"}'), finalResponse('Знайдено 1 заявку.')]);
  const o1 = await createAskOrchestrator({groq:g1, tools:queryToolsStub([ROW_SAD]), toolDefs:TOOL_DEFINITIONS}).handle('Покажи заявку Садовая 19', {});
  assert.equal(o1.meta.intent, undefined, 'show-verb with own target stays a search');
  assert.equal(o1.tickets.length, 0);
  assert.equal(o1.referentTickets.length, 1);

  /* 2) «Открой заявку Садовая 19» — explicit navigation intent WITHOUT anaphora:
        a fresh READ search runs and the found ticket card is returned. */
  const g2 = scriptedGroq([toolResponse('query_tickets', '{"mode":"list","street":"Садова","house":"19"}'), finalResponse('Відкриваю знайдену заявку.')]);
  const o2 = await createAskOrchestrator({groq:g2, tools:queryToolsStub([ROW_SAD]), toolDefs:TOOL_DEFINITIONS}).handle('Открой заявку Садовая 19', {});
  assert.equal(o2.meta.intent, 'open');
  assert.equal(o2.tickets.length, 1, 'card for the freshly found ticket');
  assert.equal(o2.tickets[0].id, 't-sad19', 'real id reaches the open action');

  /* 3) «Открой эту заявку» requires an explicit selected ticket. */
  const g3 = scriptedGroq([finalResponse('Відкриваю.')]);
  const o3 = await createAskOrchestrator({groq:g3, tools:queryToolsStub([]), toolDefs:TOOL_DEFINITIONS}).handle('Открой эту заявку', {contextTickets:o1.referentTickets});
  assert.equal(o3.meta.intent, 'open');
  assert.equal(o3.tickets.length, 0);
  assert.equal(o3.resultSetStatus.reason, 'no_selected_ticket');
});

test('navigation verbs are open intents even with a concrete target', () => {
  assert.equal(cardIntentFor('Открой заявку Садовая 19'), 'open');
  assert.equal(cardIntentFor('Открыть заявку Садовая 19'), 'open');
  assert.equal(cardIntentFor('Перейти в заявку Садовая 19'), 'open');
  assert.equal(cardIntentFor('Открой профиль заявки Садовая 19'), 'open');
  assert.equal(cardIntentFor('Відкрий заявку Садова 19'), 'open');
  assert.equal(cardIntentFor('Покажи заявку Садовая 19'), null, 'display verb without anaphora stays search');
  assert.equal(cardIntentFor('Покажи мне заявку Садовая 19'), null);
  assert.equal(cardIntentFor('Дай заявку Садовая 19'), null, 'display verb without anaphora stays search');
});

test('system prompt: no №<id> list format, technical-id hiding rule intact', () => {
  assert.ok(!/№<id>/.test(ASK_SYSTEM_PROMPT), 'model is never told to print №<id>');
  assert.ok(!/№t-101|№104\b/.test(ASK_SYSTEM_PROMPT), 'no technical ids inside prompt examples');
  assert.match(ASK_SYSTEM_PROMPT, /ТЕХНІЧНІ ІДЕНТИФІКАТОРИ/, 'hiding rule stays');
  assert.match(ASK_SYSTEM_PROMPT, /ПОРЯДКОВОЮ НУМЕРАЦІЄЮ/, 'ordinal-only lists');
  assert.match(ASK_SYSTEM_PROMPT, /У списках нумерація 1, 2, 3/, 'numbered lists rule stays');
});
