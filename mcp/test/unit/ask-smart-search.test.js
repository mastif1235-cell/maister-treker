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
