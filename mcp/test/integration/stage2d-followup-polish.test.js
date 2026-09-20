/* Stage 2D follow-up polish (v91.58), through the full Worker with the real
   phone-side AddressBook projection:
     A) «Какие улицы есть в Шевченко?» → list_directory at once, deterministic
        list, no «directory or tickets?» clarification, no model round trip;
     B) «На каких улицах Шевченко есть заявки?» → the ticket-based path;
     C) the plain answer carries no internals (DIRECTORY/TICKETS/UUID/cityId/
        streetId/KV/Worker/alias) and the prompt forbids them for the model;
     D) two tickets → «открой вторую карточку» → ticket B selected even when
        the model re-runs a search instead of get_ticket → «покажи её» opens B;
     E) after B is selected the master asks another address → the stale
        selection is flagged, the PWA drops it, «покажи її» never opens B;
     F) the Stage 2D suites stay green (run by the same npm test). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

import {createApp} from '../../src/index.js';
import {ASK_SYSTEM_PROMPT, createAskOrchestrator, streetListQuestion, directoryStreetListAnswer} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {mockGasFetch, BEARER_TOKEN} from '../helpers/mcpapp.js';

const require = createRequire(import.meta.url);
const AB = require('../../../js/address-book.js');
const Sync = require('../../../js/address-book-sync.js');

const INTERNALS = /DIRECTORY|TICKETS|UUID|cityId|streetId|city_id|street_id|\bKV\b|Worker|alias|list_directory|list_places|query_tickets|джерел|источник|справочник|довідник/i;

function gasRow(id, full, extra){
  return Object.assign({id, date:'03.06.2026', time:'17:54', content:'', sum:0, tags:[], backupNote:'', photo:null,
    fullDataJson: JSON.stringify(full)}, extra || {});
}
function fakeKv(){
  const map = new Map();
  return {map, get: async key => (map.has(key) ? map.get(key) : null), put: async (key, value) => { map.set(key, value); }};
}
function fixture(){
  const book = AB.fromLegacy({cities:['Шевченко', 'Таромське'], streets:{
    'Шевченко':['Вул Українська', 'Вул Шевченко'],
    'Таромське':['Вул Кобзаря']
  }});
  const city = name => book.cities.find(c => c.name === name);
  const street = (cityName, name) => book.streets.find(s => s.cityId === city(cityName).id && s.name === name);
  const SHEV = city('Шевченко'), TAROM = city('Таромське');
  const UKR = street('Шевченко', 'Вул Українська'), SHEV_ST = street('Шевченко', 'Вул Шевченко'), KOBZ = street('Таромське', 'Вул Кобзаря');
  const rows = [
    gasRow('t-ukr-12', {type:'Підключення', city:'Шевченко', street:'Вул Українська', house:'12', address:'Вул Українська 12', cityId:SHEV.id, streetId:UKR.id}, {date:'15.06.2026', time:'10:00'}),
    gasRow('t-ukr-31', {type:'Ремонт', city:'Шевченко', street:'Вул Українська', house:'31', address:'Вул Українська 31', cityId:SHEV.id, streetId:UKR.id}, {date:'01.06.2026', time:'15:56'}),
    gasRow('t-shev-1', {type:'Ремонт', city:'Шевченко', street:'Вул Шевченко', house:'1', address:'Вул Шевченко 1', cityId:SHEV.id, streetId:SHEV_ST.id}),
    gasRow('t-k15', {type:'Підключення', city:'Таромське', street:'Вул Кобзаря', house:'15', address:'Вул Кобзаря 15', cityId:TAROM.id, streetId:KOBZ.id})
  ];
  const kv = fakeKv();
  async function appWith(){
    const app = createApp({GAS_SYNC_URL:'https://script.google.com/macros/s/TESTDEPLOY/exec', GAS_SYNC_HMAC_SECRET:'0123456789abcdef0123456789abcdef',
      MCP_BEARER_TOKENS:'test-cli:' + BEARER_TOKEN + ':read', MT_SNAPSHOT_KV:kv}, {fetchImpl: mockGasFetch('ok', {status:'ok', tickets:rows.slice(), shifts:[], states:{ticket:[], shift:[]}})});
    await app.appPromise;
    return app;
  }
  const push = app => app.fetch(new Request('https://mcp.example.test/directory', {method:'POST',
    headers:{'Content-Type':'application/json', Authorization:'Bearer ' + BEARER_TOKEN}, body:JSON.stringify(Sync.projection(book))}));
  return {book, SHEV, TAROM, UKR, KOBZ, rows, kv, appWith, push};
}

/* a model that records what it is asked and follows a script of tool calls */
function scripted(steps){
  const state = {calls:0, messages:[]};
  const model = {chat:async function(messages){ state.messages.push(messages); const step = steps[Math.min(state.calls, steps.length - 1)]; state.calls++; return step; }, state};
  return model;
}
const callStep = (name, args) => ({ok:true, content:'', toolCalls:[{id:'c1', name, argsRaw:JSON.stringify(args)}], assistantMessage:{role:'assistant', content:'', tool_calls:[]}});
const done = text => ({ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}});

async function orchestratorFor(app){
  const loaded = await app.appPromise;
  const seen = [];
  const tools = new Proxy(loaded.tools, {get(target, name){ return async function(args){ const out = await target[name](args); seen.push({name, args, out}); return out; }; }});
  return {make: model => createAskOrchestrator({groq:model, tools, toolDefs:TOOL_DEFINITIONS}), seen};
}

test('A+C: «Какие улицы есть в Шевченко?» is answered from the address book at once — no clarification, no model, no internals', async () => {
  const f = fixture();
  const app = await f.appWith();
  assert.equal((await f.push(app)).status, 200);
  const {make, seen} = await orchestratorFor(app);
  for(const question of ['Какие улицы есть в Шевченко?', 'Какие улицы есть в поселке Шевченко?', 'Какие улицы у меня есть в Шевченко?', 'Покажи улицы Шевченко', 'Список улиц в Шевченко']){
    seen.length = 0;
    const model = scripted([done('НЕ МАЄ БУТИ ВИКЛИКАНО')]);
    const out = await make(model).handle(question, {chatSessionId:'chat-session-1'});
    assert.equal(model.state.calls, 0, question + ': answered without a model round trip');
    assert.deepEqual(seen.map(s => s.name), ['list_directory'], question + ': list_directory at once');
    assert.equal(seen[0].args.city, 'Шевченко');
    assert.equal(out.answer, 'В Шевченко у тебя 2 улицы:\n- Вул Українська\n- Вул Шевченко');
    assert.doesNotMatch(out.answer, /уточн|справочник|заявк/i, question + ': no «directory or tickets?» question');
    assert.doesNotMatch(out.answer, INTERNALS, question + ': no internals');
    assert.equal(out.resultSetStatus.subjectChanged, false, 'a street list is not a new ticket context');
  }
  /* Ukrainian phrasing, locative city, archived streets mentioned as a count only */
  AB.remember(f.book, 'Шевченко', 'Вул Нова');
  const nova = f.book.streets.find(s => s.name === 'Вул Нова');
  AB.update(f.book, 'streets', nova.id, {active:false});
  assert.equal((await f.push(app)).status, 200);
  const ua = await make(scripted([done('x')])).handle('Які вулиці у мене є в Шевченко?', {chatSessionId:'chat-session-1'});
  assert.equal(ua.answer, 'У Шевченко у тебе 2 вулиці:\n- Вул Українська\n- Вул Шевченко\nЩе 1 в архіві.');
  assert.doesNotMatch(ua.answer, INTERNALS);
  /* a case form the Stage 1 stemmer does not equate («у Шевченку»): the model
     continues with the directory's own city list and the same «no clarification» rule */
  seen.length = 0;
  const locative = scripted([callStep('list_directory', {city_id:f.SHEV.id}), done('У Шевченко у тебе 2 вулиці: Вул Українська, Вул Шевченко.')]);
  const outLocative = await make(locative).handle('Які вулиці у мене є у Шевченку?', {chatSessionId:'chat-session-1'});
  assert.equal(outLocative.ok, true);
  assert.match(locative.state.messages[0][0].content, /Населені пункти довідника: [^\n]*Шевченко \[city_id:/);
  assert.deepEqual(seen.map(s => s.name), ['list_directory', 'list_directory', 'list_directory'], 'city as written → city list → the model re-asks by city_id');
  assert.equal(seen[2].out.data.city.name, 'Шевченко');
  /* the selection of the chat survives a street-list question */
  const keep = await make(scripted([done('x')])).handle('Покажи вулиці Шевченко', {chatSessionId:'chat-session-1', selectedTicketId:'t-ukr-31'});
  assert.equal(keep.selectedTicketId, 't-ukr-31');
  /* an unknown city or a directory that was never pushed → the model continues with the same rule */
  const unknown = scripted([done('Такого населеного пункту у тебе немає — перевір назву.')]);
  const outUnknown = await make(unknown).handle('Какие улицы есть в Невідомому?', {chatSessionId:'chat-session-1'});
  assert.equal(unknown.state.calls, 1, 'unknown city: the model answers');
  assert.match(unknown.state.messages[0][0].content, /Довідник адрес для цього питання[\s\S]*city_status[\s\S]*Не питай користувача, який список йому потрібен/);
  assert.equal(outUnknown.ok, true);
  const empty = fixture();
  const appEmpty = await empty.appWith();
  const noDir = scripted([callStep('list_places', {city:'Шевченко'}), done('У Шевченко были заявки на Вул Українська и Вул Шевченко.')]);
  const {make: makeEmpty, seen: seenEmpty} = await orchestratorFor(appEmpty);
  await makeEmpty(noDir).handle('Какие улицы есть в Шевченко?', {chatSessionId:'chat-session-1'});
  assert.deepEqual(seenEmpty.map(s => s.name), ['list_directory', 'list_places'], 'directory not pushed: honest ticket-based fallback through the model');
  assert.match(noDir.state.messages[0][0].content, /"available":false[\s\S]*вулиці, де були заявки/);
});

test('A (unit): the street-list detector keeps ticket questions for the ticket tools', () => {
  for(const q of ['На каких улицах Шевченко есть заявки?', 'На каких улицах были заявки в августе?', 'Где были ремонты в Шевченко?', 'На каких улицах были подключения?', 'На каких улицах есть заявки за сегодня?', 'Какие улицы есть в Шевченко и сколько там заявок?', 'Шевченко, Свободи 8, кв.6', 'Какие улицы есть?', 'Покажи заявки Шевченко', 'Скільки вулиць у Шевченко?']){
    assert.equal(streetListQuestion(q), null, q);
  }
  assert.deepEqual(streetListQuestion('Які вулиці є в Шевченко?'), {city:'Шевченко', lang:'uk'});
  assert.deepEqual(streetListQuestion('Скажи, какие улицы существуют в Ясном'), {city:'Ясном', lang:'ru'});
  assert.deepEqual(streetListQuestion('какие улицы в Миколаївка 1'), {city:'Миколаївка 1', lang:'ru'});
  assert.equal(directoryStreetListAnswer({city:'X', lang:'ru'}, JSON.stringify({result:{available:false}})), null);
  assert.equal(directoryStreetListAnswer({city:'X', lang:'ru'}, JSON.stringify({result:{available:true, city:null, city_status:'NO_MATCH', streets:[]}})), null);
  assert.equal(directoryStreetListAnswer({city:'Миколаївка', lang:'uk'}, JSON.stringify({result:{available:true, ambiguous:true, candidates:[{name:'Миколаївка 1'}, {name:'Миколаївка 2'}], streets:[]}})),
    'Уточни, який саме населений пункт: Миколаївка 1 чи Миколаївка 2?');
  assert.equal(directoryStreetListAnswer({city:'Ясний', lang:'uk'}, JSON.stringify({result:{available:true, city:{name:'Ясний'}, streets:[], archived_street_count:0}})),
    'У Ясний у тебе поки немає жодної вулиці — вони додаються автоматично з першою заявкою в цьому населеному пункті.');
  assert.match(ASK_SYSTEM_PROMPT, /24\) Внутрішній устрій — не для користувача[^\n]*DIRECTORY\/TICKETS[^\n]*UUID[^\n]*cityId\/streetId[^\n]*Worker, KV/);
  assert.match(ASK_SYSTEM_PROMPT, /НІКОЛИ не питай користувача, який список йому потрібен/);
});

test('B: «На каких улицах Шевченко есть заявки?» stays ticket-based (query_tickets group / list_places), never the directory shortcut', async () => {
  const f = fixture();
  const app = await f.appWith();
  assert.equal((await f.push(app)).status, 200);
  const {make, seen} = await orchestratorFor(app);
  const model = scripted([callStep('query_tickets', {mode:'group', group_by:'street', city:'Шевченко'}), done('В Шевченко заявки были на Вул Українська (2) и Вул Шевченко (1).')]);
  const out = await make(model).handle('На каких улицах Шевченко есть заявки?', {chatSessionId:'chat-session-1'});
  assert.equal(model.state.calls, 2, 'the model drives the ticket question');
  assert.deepEqual(seen.map(s => s.name), ['query_tickets']);
  assert.deepEqual(seen[0].out.data.groups.map(g => [g.key, g.count]), [['Вул Українська', 2], ['Вул Шевченко', 1]]);
  assert.equal(out.ok, true);
  for(const q of ['Где были ремонты в Шевченко?', 'На каких улицах были заявки в августе?']){
    const m = scripted([callStep('list_places', {city:'Шевченко'}), done('ok')]);
    seen.length = 0;
    await make(m).handle(q, {chatSessionId:'chat-session-1'});
    assert.equal(m.state.calls, 2, q);
    assert.deepEqual(seen.map(s => s.name), ['list_places'], q + ': ticket-based path');
  }
});

test('D: two tickets → «открой вторую карточку» → B selected even when the model re-searches → «покажи её» opens B without a clarification', async () => {
  const f = fixture();
  const app = await f.appWith();
  assert.equal((await f.push(app)).status, 200);
  const {make, seen} = await orchestratorFor(app);
  /* turn 1: the street question is answered through find_tickets_by_address (a
     «legacy» tool for result sets: referents only, no chat result set) */
  const t1 = await make(scripted([callStep('find_tickets_by_address', {address:'Українська'}), done('На Українській 2 заявки: 1. 15.06.2026 — Вул Українська 12; 2. 01.06.2026 — Вул Українська 31.')]))
    .handle('Заявки на Українській', {chatSessionId:'chat-session-1'});
  assert.equal(t1.resultSet, null, 'legacy tool: no chat result set');
  assert.deepEqual(t1.referentTickets.map(t => t.id), ['t-ukr-12', 't-ukr-31'], 'referents in the order the model was shown');
  assert.equal(t1.selectedTicketId, null);
  /* turn 2 — the production failure mode: the model re-runs the search instead
     of get_ticket; the ordinal is nevertheless resolved deterministically from
     the referent order and B is the recorded selection */
  seen.length = 0;
  const t2model = scripted([callStep('find_tickets_by_address', {address:'Українська'}), done('Вторая заявка: Українська 31, 01.06.2026 15:56.')]);
  const t2 = await make(t2model).handle('Открой вторую карточку', {chatSessionId:'chat-session-1', contextTickets:t1.referentTickets});
  assert.equal(t2.selectedTicketId, 't-ukr-31', 'the second referent is the selection');
  assert.deepEqual(t2.presentation, {kind:'single_ticket', ticket_id:'t-ukr-31'});
  assert.equal(t2.resultSetStatus.reason, 'selected_ticket');
  assert.equal(t2.resultSet, null, 'the re-run search does not replace the selection with a new list');
  assert.ok(seen.some(s => s.name === 'get_ticket' && s.args.ticket_id === 't-ukr-31'), 'the locked ticket was read fresh');
  /* the same turn when the model asks for a different ticket id: the lock wins */
  const t2b = await make(scripted([callStep('get_ticket', {ticket_id:'t-ukr-12'}), done('ok')])).handle('Дай картку другої', {chatSessionId:'chat-session-1', contextTickets:t1.referentTickets});
  assert.equal(t2b.selectedTicketId, 't-ukr-31');
  /* turn 3: «покажи её» with the selection the PWA stored → opens B, no model, no question */
  for(const phrase of ['Покажи мне её', 'покажи её', 'открой её', 'открой эту', 'покажи эту карточку', 'открой карточку', 'відкрий її']){
    const m = scripted([done('x')]);
    const t3 = await make(m).handle(phrase, {chatSessionId:'chat-session-1', selectedTicketId:'t-ukr-31'});
    assert.equal(m.state.calls, 0, phrase + ': deterministic');
    assert.deepEqual(t3.presentation, {kind:'single_ticket', ticket_id:'t-ukr-31'}, phrase);
    assert.equal(t3.selectedTicketId, 't-ukr-31');
    assert.doesNotMatch(t3.answer, /уточните/i, phrase + ': no clarification');
  }
  /* an ordinal beyond the referents is left to the ordinary flow (nothing guessed) */
  const beyond = scripted([done('Таких заявок было только две.')]);
  const t4 = await make(beyond).handle('Открой третью карточку', {chatSessionId:'chat-session-1', contextTickets:t1.referentTickets});
  assert.equal(t4.selectedTicketId, null);
  assert.equal(beyond.state.calls, 1);
});

test('E: after B is selected, another address moves the subject — the stale selection is flagged and «покажи її» opens the new ticket, not B', async () => {
  const f = fixture();
  const app = await f.appWith();
  assert.equal((await f.push(app)).status, 200);
  const {make} = await orchestratorFor(app);
  /* the master asks another address while t-ukr-31 is selected */
  const moved = await make(scripted([callStep('find_tickets_by_address', {address:'Кобзаря 15'}), done('Кобзаря 15: подключение 03.06.2026.')]))
    .handle('Кобзаря 15', {chatSessionId:'chat-session-1', selectedTicketId:'t-ukr-31'});
  assert.equal(moved.selectedTicketId, null);
  assert.equal(moved.resultSetStatus.selectionChanged, true, 'this turn brought other tickets only → the PWA drops the old selection');
  assert.deepEqual(moved.referentTickets.map(t => t.id), ['t-k15']);
  /* what the PWA does next: no selection, the new referent is sent as context */
  const open = await make(scripted([done('x')])).handle('покажи її', {chatSessionId:'chat-session-1', contextTickets:moved.referentTickets});
  assert.deepEqual(open.presentation, {kind:'single_ticket', ticket_id:'t-k15'}, 'the new ticket opens, never the stale B');
  /* a field question ABOUT the selected ticket keeps the selection */
  const field = await make(scripted([callStep('get_ticket', {ticket_id:'t-ukr-31'}), done('Сигнал там не вказано.')]))
    .handle('а який там сигнал?', {chatSessionId:'chat-session-1', selectedTicketId:'t-ukr-31'});
  assert.equal(field.resultSetStatus.selectionChanged, undefined, 'the row of the selected ticket itself is not a subject change');
  assert.equal(field.selectedTicketId, 't-ukr-31', 'get_ticket of the selected ticket re-selects it');
  /* a pure text answer (no rows) never touches the selection */
  const text = await make(scripted([done('Так, це можливо.')])).handle('це можливо?', {chatSessionId:'chat-session-1', selectedTicketId:'t-ukr-31'});
  assert.equal(text.resultSetStatus.selectionChanged, undefined);
  /* a search that still includes the selected ticket among its rows keeps it */
  const street = await make(scripted([callStep('find_tickets_by_address', {address:'Українська'}), done('2 заявки.')]))
    .handle('а що ще на Українській?', {chatSessionId:'chat-session-1', selectedTicketId:'t-ukr-31'});
  assert.equal(street.resultSetStatus.selectionChanged, undefined);
});
