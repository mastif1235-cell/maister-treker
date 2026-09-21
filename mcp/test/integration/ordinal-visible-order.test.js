/* v91.60 regression — visible numbering IS the ordinal, and every unambiguous
   card request yields the standard single card (presentation single_ticket).

   Fixture: the production case. «Матроська 22» exists in two places:
     Дніпро, Матроська 22, кв. 4   (10.06.2026)  — the OLDER row
     Таромське, Матроська 22, кв. 2 (15.06.2026) — the NEWER row
   The READ tools return rows newest-first (Таромське, Дніпро) while the model
   prints «1. Дніпро …, 2. Таромское …» — the master reads the printed list.

     A) «Открой первую карточку» → Дніпро (the first PRINTED, not the first row);
     B) «Открой вторую карточку» → Таромське;
     C) after «А открой Днипро матроська 22» → «Покажи карточку его» → single_ticket of Дніпро;
     D) «Покажи профиль абонента» → the same card;
     E) «Мне нужна карточка Днипро Матроська 22 кв 4» → the same card (exact address);
     F) referent change: Таромське was selected, «А открой Днипро матроська 22» moves
        the selection; «покажи его карточку» / «покажи её» / «покажи профиль» refer to
        Дніпро and the old ticket is never used;
     G) genuine ambiguity («покажи карточку» right after the two-city answer, and
        «Открой карточку Матроська 22» without a city) → honest clarification, no card. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

import {createApp} from '../../src/index.js';
import {createAskOrchestrator, cardIntentFor, structuredFromAddressLine} from '../../src/ask/orchestrator.js';
import {alignRowsToAnswer, numberedRuns} from '../../src/ask/answer-order.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {mockGasFetch, BEARER_TOKEN} from '../helpers/mcpapp.js';

const require = createRequire(import.meta.url);
const AB = require('../../../js/address-book.js');
const Sync = require('../../../js/address-book-sync.js');

const DNIPRO_ID = 't-dnipro-22-4';
const TAROM_ID = 't-tarom-22-2';
const NOW = new Date('2026-09-20T12:00:01Z');
const SESSION = 'chat-session-matroska';

function gasRow(id, full, extra){
  return Object.assign({id, date:'03.06.2026', time:'17:54', content:'', sum:0, tags:[], backupNote:'', photo:null,
    fullDataJson: JSON.stringify(full)}, extra || {});
}
function fakeKv(){
  const map = new Map();
  return {map, get: async key => (map.has(key) ? map.get(key) : null), put: async (key, value) => { map.set(key, value); }};
}
async function fixture(){
  const book = AB.fromLegacy({cities:['Дніпро', 'Таромське'], streets:{'Дніпро':['Вул Матроська'], 'Таромське':['Вул Матроська']}});
  const DN = book.cities.find(c => c.name === 'Дніпро'), TA = book.cities.find(c => c.name === 'Таромське');
  const DNS = book.streets.find(s => s.cityId === DN.id), TAS = book.streets.find(s => s.cityId === TA.id);
  const rows = [
    gasRow(DNIPRO_ID, {type:'Підключення', city:'Дніпро', street:'Вул Матроська', house:'22', apartment:'4', address:'Вул Матроська 22', cityId:DN.id, streetId:DNS.id}, {date:'10.06.2026', time:'10:00'}),
    gasRow(TAROM_ID, {type:'Ремонт', city:'Таромське', street:'Вул Матроська', house:'22', apartment:'2', address:'Вул Матроська 22', cityId:TA.id, streetId:TAS.id}, {date:'15.06.2026', time:'12:00'})
  ];
  const kv = fakeKv();
  const app = createApp({GAS_SYNC_URL:'https://script.google.com/macros/s/TESTDEPLOY/exec', GAS_SYNC_HMAC_SECRET:'0123456789abcdef0123456789abcdef',
    MCP_BEARER_TOKENS:'test-cli:' + BEARER_TOKEN + ':read', MT_SNAPSHOT_KV:kv}, {fetchImpl: mockGasFetch('ok', {status:'ok', tickets:rows.slice(), shifts:[], states:{ticket:[], shift:[]}})});
  await app.appPromise;
  await app.fetch(new Request('https://mcp.example.test/directory', {method:'POST',
    headers:{'Content-Type':'application/json', Authorization:'Bearer ' + BEARER_TOKEN}, body:JSON.stringify(Sync.projection(book))}));
  const loaded = await app.appPromise;
  return loaded.tools;
}
function scripted(steps){
  const state = {calls:0};
  return {chat:async function(){ const step = steps[Math.min(state.calls, steps.length - 1)]; state.calls++; return step; }, state};
}
const callStep = (name, args) => ({ok:true, content:'', toolCalls:[{id:'c1', name, argsRaw:JSON.stringify(args)}], assistantMessage:{role:'assistant', content:'', tool_calls:[]}});
const done = text => ({ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}});

/* The production answer: cities in the model's own order (Дніпро first). */
const CITY_ANSWER = 'Адрес Матроська 22 есть в двух населённых пунктах:\n1. Дніпро — Матроська 22, кв. 4 (10.06.2026, подключение)\n2. Таромское — Матроська 22, кв. 2 (15.06.2026, ремонт)';

async function cityTurn(tools){
  const make = model => createAskOrchestrator({groq:model, tools, toolDefs:TOOL_DEFINITIONS});
  /* production path: the model used the free-text tool, rows come back newest-first */
  const t1 = await make(scripted([callStep('search_tickets', {query:'Матроська 22'}), done(CITY_ANSWER)]))
    .handle('В каком городе есть адрес Матроська 22', {chatSessionId:SESSION, now:NOW});
  assert.equal(t1.ok, true);
  assert.equal(t1.presentation, null, 'a city question opens no card');
  return {make, t1};
}

test('A+B: «первую»/«вторую» follow the PRINTED order, not the hidden tool order', async () => {
  const tools = await fixture();
  const {make, t1} = await cityTurn(tools);
  assert.deepEqual(t1.referentTickets.map(t => t.id), [DNIPRO_ID, TAROM_ID], 'referents are stored in the order the user sees');
  assert.equal(t1.referentTickets[0].address, 'Дніпро, Вул Матроська 22, кв. 4');

  /* A — the model even re-runs a search instead of get_ticket; the lock wins */
  const a = await make(scripted([callStep('search_tickets', {query:'Матроська 22'}), done('Открываю карточку: Дніпро, Матроська 22, кв. 4.')]))
    .handle('Открой первую карточку', {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets});
  assert.equal(a.selectedTicketId, DNIPRO_ID, 'первая = Дніпро (printed #1)');
  assert.deepEqual(a.presentation, {kind:'single_ticket', ticket_id:DNIPRO_ID});
  assert.deepEqual(a.tickets, [], 'no competing card list next to the single card');

  /* B */
  const b = await make(scripted([callStep('search_tickets', {query:'Матроська 22'}), done('Открываю карточку: Таромское, Матроська 22, кв. 2.')]))
    .handle('Открой вторую карточку', {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets});
  assert.equal(b.selectedTicketId, TAROM_ID, 'вторая = Таромське (printed #2)');
  assert.deepEqual(b.presentation, {kind:'single_ticket', ticket_id:TAROM_ID});
});

test('A (result set): a query_tickets list printed in another order stores that visible order', async () => {
  const tools = await fixture();
  const make = model => createAskOrchestrator({groq:model, tools, toolDefs:TOOL_DEFINITIONS});
  const t1 = await make(scripted([callStep('query_tickets', {mode:'list', street:'Матроська', house:'22', city:'Дніпро'}), done('1. Дніпро — Матроська 22, кв. 4 (10.06.2026)')]))
    .handle('Покажи заявки Матроська 22 в Днепре', {chatSessionId:SESSION, now:NOW});
  assert.equal(t1.resultItems.length, 1);
  /* two-row list from the free-text tool as the authoritative-list analogue */
  const listTools = Object.assign({}, tools, {query_tickets: async function(){
    const both = await tools.search_tickets({query:'Матроська 22'});
    return {ok:true, data:{tool:'query_tickets', mode:'list', matched:2, total_matched:2, tickets:both.data.tickets.map((t, i) => Object.assign({ord:i + 1}, t)), resolved_filters:{street:'Матроська', house:'22'}, coverage:{}}};
  }});
  const t2 = await createAskOrchestrator({groq:scripted([callStep('query_tickets', {mode:'list', street:'Матроська', house:'22'}), done(CITY_ANSWER)]), tools:listTools, toolDefs:TOOL_DEFINITIONS})
    .handle('Где есть адрес Матроська 22', {chatSessionId:SESSION, now:NOW});
  assert.deepEqual(t2.resultSet.ticketIds, [DNIPRO_ID, TAROM_ID], 'the stored list follows the printed numbering');
  assert.deepEqual(t2.resultItems.map(i => i.ticket_id), [DNIPRO_ID, TAROM_ID]);
  assert.deepEqual(t2.resultItems.map(i => i.index), [1, 2]);
  /* «покажи 1-ю» against that set → Дніпро */
  const one = await createAskOrchestrator({groq:scripted([done('Открываю.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 1-ю', {chatSessionId:SESSION, now:NOW, resultSet:t2.resultSet});
  assert.deepEqual(one.presentation, {kind:'single_ticket', ticket_id:DNIPRO_ID});
});

test('C+D+E: after «А открой Днипро матроська 22» every card phrase yields the standard single card of Дніпро', async () => {
  const tools = await fixture();
  const {make, t1} = await cityTurn(tools);

  /* the master names the exact address; the model answers from context (no tool) */
  const open = await make(scripted([done('Дніпро, Матроська 22, кв. 4 — подключение 10.06.2026.')]))
    .handle('А открой Днипро матроська 22', {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets});
  assert.equal(cardIntentFor('А открой Днипро матроська 22'), 'open');
  assert.equal(open.selectedTicketId, DNIPRO_ID, 'exact address resolved from the previous answer');
  assert.deepEqual(open.presentation, {kind:'single_ticket', ticket_id:DNIPRO_ID});

  /* the same phrase when the model DOES run a fresh READ (rows newest-first) */
  const open2 = await make(scripted([callStep('search_tickets', {query:'Матроська 22'}), done('Дніпро, Матроська 22, кв. 4.')]))
    .handle('А открой Днипро матроська 22', {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets});
  assert.deepEqual(open2.presentation, {kind:'single_ticket', ticket_id:DNIPRO_ID});

  /* C, D — no model round-trip, the stored selection is the subject */
  for(const phrase of ['Покажи карточку его', 'Покажи профиль абонента', 'покажи его карточку', 'покажи карточку', 'покажи её', 'открой карточку', 'открой заявку', 'покажи заявку', 'покажи профиль', 'открой профиль', 'Покажи его карточку.']){
    const m = scripted([done('x')]);
    const out = await make(m).handle(phrase, {chatSessionId:SESSION, now:NOW, selectedTicketId:DNIPRO_ID});
    assert.equal(m.state.calls, 0, phrase + ': answered by the code');
    assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:DNIPRO_ID}, phrase + ' → the standard card of Дніпро');
    assert.equal(out.selectedTicketId, DNIPRO_ID);
    assert.equal(out.resultSetStatus.reason, 'selected_ticket');
    assert.doesNotMatch(out.answer, /уточните|не выбрана/i, phrase + ': no clarification');
  }

  /* E — the exact address with the apartment, the model answers from the referents */
  const e = await make(scripted([done('Дніпро, Матроська 22, кв. 4 — подключение 10.06.2026.')]))
    .handle('Мне нужна карточка Днипро Матроська 22 кв 4', {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets, selectedTicketId:DNIPRO_ID});
  assert.deepEqual(e.presentation, {kind:'single_ticket', ticket_id:DNIPRO_ID});
  /* E with a fresh READ by the model (rows arrive newest-first: Таромське first) */
  const e2 = await make(scripted([callStep('search_tickets', {query:'Матроська 22'}), done('Дніпро, Матроська 22, кв. 4.')]))
    .handle('Мне нужна карточка Днипро Матроська 22 кв 4', {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets});
  assert.deepEqual(e2.presentation, {kind:'single_ticket', ticket_id:DNIPRO_ID}, 'the exact row, never «the first row»');
});

test('F: the selection moves from Таромське to Дніпро — the old ticket is never used again', async () => {
  const tools = await fixture();
  const {make, t1} = await cityTurn(tools);
  const second = await make(scripted([callStep('search_tickets', {query:'Матроська 22'}), done('Таромское, Матроська 22, кв. 2.')]))
    .handle('Открой вторую карточку', {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets});
  assert.equal(second.selectedTicketId, TAROM_ID);

  /* the master moves on: exact other address while Таромське is selected */
  const moved = await make(scripted([callStep('search_tickets', {query:'Матроська 22'}), done('Дніпро, Матроська 22, кв. 4 — подключение.')]))
    .handle('А открой Днипро матроська 22', {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets, selectedTicketId:TAROM_ID});
  assert.equal(moved.selectedTicketId, DNIPRO_ID, 'the selection is replaced by Дніпро');
  assert.deepEqual(moved.presentation, {kind:'single_ticket', ticket_id:DNIPRO_ID});
  assert.equal(moved.resultSetStatus.reason, 'selected_ticket');

  /* the PWA now stores Дніпро; every anaphora refers to it */
  for(const phrase of ['покажи его карточку', 'покажи её', 'покажи профиль', 'Покажи карточку его']){
    const out = await make(scripted([done('x')])).handle(phrase, {chatSessionId:SESSION, now:NOW, selectedTicketId:moved.selectedTicketId});
    assert.equal(out.presentation.ticket_id, DNIPRO_ID, phrase + ' → Дніпро');
    assert.notEqual(out.presentation.ticket_id, TAROM_ID, phrase + ': the old Таромське ticket is not used');
  }

  /* a field question about ANOTHER address (no open verb) still flags the stale selection */
  const other = await make(scripted([callStep('search_tickets', {query:'Матроська 22 Дніпро'}), done('Подключение 10.06.2026.')]))
    .handle('Когда я был на Днипро Матроська 22?', {chatSessionId:SESSION, now:NOW, selectedTicketId:TAROM_ID});
  assert.equal(other.presentation, null);
  /* the READ brought only the Дніпро row → the stale Таромське selection is flagged for the PWA to drop */
  assert.equal(other.resultSetStatus.selectionChanged, true);
  assert.deepEqual(other.referentTickets.map(t => t.id), [DNIPRO_ID], 'the next «покажи её» resolves through the new referent');
});

test('G: genuine ambiguity is clarified honestly — no card, no guess', async () => {
  const tools = await fixture();
  const {make, t1} = await cityTurn(tools);
  /* right after the two-city answer, without a selection */
  for(const phrase of ['покажи карточку', 'Покажи карточку его', 'открой её', 'покажи профиль абонента']){
    const m = scripted([done('x')]);
    const out = await make(m).handle(phrase, {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets});
    assert.equal(m.state.calls, 0);
    assert.equal(out.presentation, null, phrase + ': two candidates → no card');
    assert.match(out.answer, /уточните/i);
    assert.equal(out.resultSetStatus.reason, 'no_selected_ticket');
  }
  /* an exact-looking address that matches BOTH rows (no city) is not resolved */
  const both = await make(scripted([callStep('search_tickets', {query:'Матроська 22'}), done('Есть две заявки: Дніпро и Таромское.')]))
    .handle('Открой карточку Матроська 22', {chatSessionId:SESSION, now:NOW, contextTickets:t1.referentTickets});
  assert.equal(both.presentation, null, 'two rows share street+house → the master picks');
  assert.equal(both.selectedTicketId, null);
  assert.equal(both.tickets.length, 2, 'both cards are offered instead');
});

test('alignRowsToAnswer: strict matching — unmatched, partial or ambiguous lists keep the tool order', () => {
  const rows = [
    {id:'t-b', date:'15.06.2026', time:'12:00', city:'Таромське', street:'Вул Матроська', house:'22', apartment:'2', type:'Ремонт'},
    {id:'t-a', date:'10.06.2026', time:'10:00', city:'Дніпро', street:'Вул Матроська', house:'22', apartment:'4', type:'Підключення'}
  ];
  assert.deepEqual(alignRowsToAnswer(CITY_ANSWER, rows).map(r => r.id), ['t-a', 't-b'], 'aligned to the printed list');
  assert.deepEqual(alignRowsToAnswer('Найдено 2 заявки на Матроській 22.', rows).map(r => r.id), ['t-b', 't-a'], 'no numbered list → unchanged');
  assert.deepEqual(alignRowsToAnswer('1. Матроська 22\n2. Матроська 22', rows).map(r => r.id), ['t-b', 't-a'], 'items that fit both rows → unchanged');
  assert.deepEqual(alignRowsToAnswer('1. Дніпро — кв. 4\n2. Дніпро — кв. 4', rows).map(r => r.id), ['t-b', 't-a'], 'one row claimed twice → unchanged');
  assert.deepEqual(alignRowsToAnswer('1. Таромское, кв. 2\n2. Дніпро, кв. 4\n3. Шевченко, Садова 1', rows).map(r => r.id), ['t-b', 't-a'], 'more items than rows → unchanged');
  /* a list mentioning only the second row moves it first, the rest keep their order */
  const three = rows.concat([{id:'t-c', date:'01.06.2026', time:'09:00', city:'Шевченко', street:'Вул Садова', house:'1', type:'Ремонт'}]);
  assert.deepEqual(alignRowsToAnswer('1. Шевченко — Садова 1 (01.06.2026)\n2. Дніпро — Матроська 22, кв. 4 (10.06.2026)', three).map(r => r.id), ['t-c', 't-a', 't-b']);
  /* the correct sequence passes through untouched */
  assert.deepEqual(alignRowsToAnswer('1. 15.06.2026 — Таромське, Матроська 22, кв. 2\n2. 10.06.2026 — Дніпро, Матроська 22, кв. 4', rows).map(r => r.id), ['t-b', 't-a']);
  /* multi-line DeepSeek items (blank lines + dash continuations) form one run */
  const md = '1. **10.06.2026** — Дніпро\n   — Матроська 22, кв. 4\n\n2. **15.06.2026** — Таромське\n   — Матроська 22, кв. 2';
  assert.equal(numberedRuns(md).length, 1);
  assert.deepEqual(alignRowsToAnswer(md, rows).map(r => r.id), ['t-a', 't-b']);
  /* the same ticket printed in two separate runs never duplicates rows */
  assert.equal(alignRowsToAnswer(CITY_ANSWER, rows.concat([rows[0]])).length, 2);
});

test('structuredFromAddressLine parses only the Worker\'s own one-line address format', () => {
  assert.deepEqual(structuredFromAddressLine('Дніпро, Вул Матроська 22, кв. 4'), {street:'Вул Матроська', house:'22', city:'Дніпро'});
  assert.deepEqual(structuredFromAddressLine('Вул Садова 2а'), {street:'Вул Садова', house:'2а', city:''});
  assert.equal(structuredFromAddressLine('Дніпро'), null);
  assert.equal(structuredFromAddressLine(''), null);
  assert.equal(structuredFromAddressLine('кв. 4'), null);
});
