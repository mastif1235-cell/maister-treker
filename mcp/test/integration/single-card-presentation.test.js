/* v91.59 regression, presentation routing through the full Worker:
     A) two tickets → «Открой карточку вторую» → ticket B, presentation
        single_ticket (the standard card in the PWA), intent cards — never map;
     B) «покажи её» → the same single_ticket presentation of B;
     C) one result («Покажи адреса на улице Садова в Шевченко») → «покажи
        карточку заявки» → no clarification, single_ticket of that ticket — both
        with a chat result set (query_tickets list) and with referents only
        (find_tickets_by_address);
     E) a card/open request never yields a map presentation; the map intent
        exists only when the user asks for the map. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

import {createApp} from '../../src/index.js';
import {createAskOrchestrator, cardIntentFor} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {mockGasFetch, BEARER_TOKEN} from '../helpers/mcpapp.js';

const require = createRequire(import.meta.url);
const AB = require('../../../js/address-book.js');
const Sync = require('../../../js/address-book-sync.js');

function gasRow(id, full, extra){
  return Object.assign({id, date:'03.06.2026', time:'17:54', content:'', sum:0, tags:[], backupNote:'', photo:null,
    fullDataJson: JSON.stringify(full)}, extra || {});
}
function fakeKv(){
  const map = new Map();
  return {map, get: async key => (map.has(key) ? map.get(key) : null), put: async (key, value) => { map.set(key, value); }};
}
function fixture(){
  const book = AB.fromLegacy({cities:['Шевченко'], streets:{'Шевченко':['Вул Українська', 'Вул Садова']}});
  const SHEV = book.cities[0];
  const UKR = book.streets.find(s => s.name === 'Вул Українська'), SAD = book.streets.find(s => s.name === 'Вул Садова');
  const rows = [
    gasRow('t-ukr-20', {type:'Підключення', city:'Шевченко', street:'Вул Українська', house:'20', address:'Вул Українська 20', cityId:SHEV.id, streetId:UKR.id}, {date:'15.06.2026', time:'10:00'}),
    gasRow('t-ukr-31', {type:'Ремонт', city:'Шевченко', street:'Вул Українська', house:'31', address:'Вул Українська 31', cityId:SHEV.id, streetId:UKR.id}, {date:'01.06.2026', time:'15:56'}),
    gasRow('t-sad-2a', {type:'Ремонт', city:'Шевченко', street:'Вул Садова', house:'2а', address:'Вул Садова 2а', cityId:SHEV.id, streetId:SAD.id}, {date:'10.06.2026', time:'09:30'})
  ];
  const kv = fakeKv();
  async function appWith(){
    const app = createApp({GAS_SYNC_URL:'https://script.google.com/macros/s/TESTDEPLOY/exec', GAS_SYNC_HMAC_SECRET:'0123456789abcdef0123456789abcdef',
      MCP_BEARER_TOKENS:'test-cli:' + BEARER_TOKEN + ':read', MT_SNAPSHOT_KV:kv}, {fetchImpl: mockGasFetch('ok', {status:'ok', tickets:rows.slice(), shifts:[], states:{ticket:[], shift:[]}})});
    await app.appPromise;
    await app.fetch(new Request('https://mcp.example.test/directory', {method:'POST',
      headers:{'Content-Type':'application/json', Authorization:'Bearer ' + BEARER_TOKEN}, body:JSON.stringify(Sync.projection(book))}));
    const loaded = await app.appPromise;
    return {app, tools:loaded.tools};
  }
  return {appWith};
}
function scripted(steps){
  const state = {calls:0};
  return {chat:async function(){ const step = steps[Math.min(state.calls, steps.length - 1)]; state.calls++; return step; }, state};
}
const callStep = (name, args) => ({ok:true, content:'', toolCalls:[{id:'c1', name, argsRaw:JSON.stringify(args)}], assistantMessage:{role:'assistant', content:'', tool_calls:[]}});
const done = text => ({ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}});
const NOW = new Date('2026-09-20T12:00:01Z');

test('A+B+E: «Открой карточку вторую» → single_ticket B (standard card), «покажи её» → the same; never a map presentation', async () => {
  const {tools} = await fixture().appWith();
  const make = model => createAskOrchestrator({groq:model, tools, toolDefs:TOOL_DEFINITIONS});
  /* turn 1 — the production phrase: two tickets found through the address tool */
  const t1 = await make(scripted([callStep('find_tickets_by_address', {address:'Українська Шевченко'}), done('Знайдено 2 заявки: 1. 15.06.2026 — Українська 20; 2. 01.06.2026 — Українська 31.')]))
    .handle('А покажи по улице украинской адреса в поселке Шевченко?', {chatSessionId:'chat-session-1', now:NOW});
  assert.deepEqual(t1.referentTickets.map(t => t.id), ['t-ukr-20', 't-ukr-31']);
  assert.equal(t1.presentation, null);
  /* turn 2 — the ordinal (noun before the numeral, as the master typed it) */
  const t2model = scripted([callStep('find_tickets_by_address', {address:'Українська'}), done('Заявка №2: Шевченко, Українська 31, 01.06.2026 15:56.')]);
  const t2 = await make(t2model).handle('Открой карточку вторую', {chatSessionId:'chat-session-1', now:NOW, contextTickets:t1.referentTickets});
  assert.equal(t2.selectedTicketId, 't-ukr-31');
  assert.deepEqual(t2.presentation, {kind:'single_ticket', ticket_id:'t-ukr-31'}, 'the standard single card of B');
  assert.equal(t2.meta.intent, 'cards', 'a card request, not a map request');
  assert.deepEqual(t2.tickets, [], 'no competing card list');
  assert.doesNotMatch(t2.answer, /уточните/i);
  /* turn 3 — «покажи её» with the stored selection */
  for(const phrase of ['покажи её', 'Покажи мне её', 'открой её', 'покажи эту карточку']){
    const m = scripted([done('x')]);
    const t3 = await make(m).handle(phrase, {chatSessionId:'chat-session-1', now:NOW, selectedTicketId:'t-ukr-31'});
    assert.equal(m.state.calls, 0, phrase);
    assert.deepEqual(t3.presentation, {kind:'single_ticket', ticket_id:'t-ukr-31'}, phrase + ': the same standard card of B');
    assert.notEqual(t3.meta.intent, 'map', phrase + ': never a map');
    assert.doesNotMatch(t3.answer, /уточните/i, phrase);
  }
  /* E: the map intent exists only for an explicit map request */
  assert.equal(cardIntentFor('Открой карточку вторую'), 'cards');
  assert.equal(cardIntentFor('покажи карточку заявки'), 'cards');
  assert.equal(cardIntentFor('открой заявку'), 'open');
  assert.equal(cardIntentFor('покажи её на карте'), 'map');
  assert.equal(cardIntentFor('покажи цю заявку на карті'), 'map');
});

test('C: one result → «покажи карточку заявки» → no clarification, single_ticket of that ticket (result-set path and referent path)', async () => {
  const {tools} = await fixture().appWith();
  const make = model => createAskOrchestrator({groq:model, tools, toolDefs:TOOL_DEFINITIONS});
  /* (i) query_tickets list → a chat result set with exactly one item */
  const list = await make(scripted([callStep('query_tickets', {mode:'list', city:'Шевченко', street:'Садова'}), done('На Садовій у Шевченко одна заявка: 1. 10.06.2026 — Садова 2а.')]))
    .handle('Покажи адреса на улице Садова в Шевченко', {chatSessionId:'chat-session-1', now:NOW});
  assert.ok(list.resultSet && list.resultSet.ticketIds.length === 1, 'a one-item result set');
  assert.deepEqual(list.resultSet.ticketIds, ['t-sad-2a']);
  const cardModel = scripted([done('x')]);
  const card = await make(cardModel).handle('покажи карточку заявки', {chatSessionId:'chat-session-1', now:NOW, resultSet:list.resultSet});
  assert.equal(cardModel.state.calls, 0, 'deterministic, no model');
  assert.deepEqual(card.presentation, {kind:'single_ticket', ticket_id:'t-sad-2a'}, 'the single result opens as the standard card');
  assert.equal(card.selectedTicketId, 't-sad-2a');
  assert.doesNotMatch(card.answer, /уточните|не выбрана/i, 'no «which ticket» clarification for a single result');
  /* (ii) the address tool → one referent only */
  const legacy = await make(scripted([callStep('find_tickets_by_address', {address:'Садова Шевченко'}), done('Одна заявка: Садова 2а.')]))
    .handle('Покажи адреса на улице Садова в Шевченко', {chatSessionId:'chat-session-2', now:NOW});
  assert.equal(legacy.resultSet, null);
  assert.deepEqual(legacy.referentTickets.map(t => t.id), ['t-sad-2a']);
  for(const phrase of ['покажи карточку заявки', 'открой карточку', 'открой заявку', 'покажи заявку']){
    const m = scripted([done('x')]);
    const out = await make(m).handle(phrase, {chatSessionId:'chat-session-2', now:NOW, contextTickets:legacy.referentTickets});
    assert.equal(m.state.calls, 0, phrase);
    assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'t-sad-2a'}, phrase);
    assert.doesNotMatch(out.answer, /уточните|не выбрана/i, phrase);
  }
  /* an honest clarification stays for genuinely several candidates without a number */
  const two = await make(scripted([callStep('find_tickets_by_address', {address:'Українська'}), done('2 заявки.')]))
    .handle('Українська', {chatSessionId:'chat-session-3', now:NOW});
  const ambiguous = await make(scripted([done('x')])).handle('покажи карточку заявки', {chatSessionId:'chat-session-3', now:NOW, contextTickets:two.referentTickets});
  assert.equal(ambiguous.presentation, null);
  assert.match(ambiguous.answer, /Уточните, какую заявку открыть/);
});
