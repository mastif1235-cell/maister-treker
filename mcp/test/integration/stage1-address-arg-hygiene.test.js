/* v91.51 Stage-1 fixing pass — regression suite (A–G).

   Everything here is synthetic: the addresses, cities and houses come from the
   audit fixture matrix (/home/user/audit-v9151/fixtures.mjs), never from
   production data. The suite pins exactly the four local fixes of this pass:

   A. a house left inside the `street` argument no longer loses the row;
   B. apartment numbers compare canonically («1» ≡ «кв. 1» ≡ «квартира 1»);
   C. settlement prefixes («посёлок/село/смт/с.») are stripped, real names kept;
   D. word ordinals («вторую», «номер два») resolve against the active list;
   E. F4 exact-address also fires on the turn's OWN authoritative list, while a
      list request stays a list;
   F. ONE address projection: filled structured parts always give a non-empty
      one-line address;
   G. negatives (money/date/count/phone/signal never become a house, quantities
      never become an ordinal) and the snapshot freshness meta stays additive. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createReadTools, createDataPipeline} from '../../src/tools/read.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {createAskOrchestrator, detectExplicitOrdinal} from '../../src/ask/orchestrator.js';
import {createResultSet} from '../../src/ask/result-set.js';
import {hygieneArgs, splitStreetHouse, normalizeCityArg} from '../../src/ask/arg-hygiene.js';
import {normalizeApartment, buildAddressLine} from '../../src/ask/address.js';

/* ---------- synthetic fixtures + harnesses ---------- */

function gasRow(id, full, extra){
  return Object.assign({id, date:'10.06.2026', time:'10:00', content:'', sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify(full), photo:null}, extra || {});
}

function toolsFrom(rows, meta){
  /* the real REDACTION pipeline (same one the Worker uses), optionally dressed
     like the KV snapshot provider, which adds savedAt/cache to the same call */
  const pipeline = createDataPipeline({
    getList: async function(){ return {ok:true, data:{tickets:rows, shifts:[]}}; }
  });
  const provider = {
    getList: async function(){
      const out = await pipeline.getList();
      if(!out.ok) return out;
      return meta ? Object.assign(out, {savedAt:meta.savedAt, cache:meta.cache}) : out;
    }
  };
  return createReadTools({data:provider});
}

function call(name, args, id='c1'){
  return {ok:true, content:'', toolCalls:[{id, name, argsRaw:JSON.stringify(args)}], assistantMessage:{role:'assistant', content:'', tool_calls:[]}};
}
function done(text='ok'){ return {ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}}; }
function groq(steps){ let i = 0; return {calls:0, chat:async function(){ this.calls++; const step = steps[Math.min(i, steps.length - 1)]; i++; return step; }}; }

/* ================= A: street + house in one argument ================= */

test('A: a house inside the street argument is split and the structured row is found', async () => {
  const rows = [
    gasRow('t-a1', {type:'Ремонт', city:'Ясний', street:'Вул Новопокровська', house:'37'}),
    gasRow('t-a2', {type:'Ремонт', city:'Ясний', street:'Вул Новопокровська', house:'39'})
  ];
  const tools = toolsFrom(rows);

  /* the raw model shape used to match nothing */
  const raw = await tools.query_tickets({mode:'list', street:'Новопокровская 37'});
  assert.equal(raw.data.matched, 0, '«Новопокровская 37» as one argument is the production bug');

  const split = hygieneArgs('query_tickets', {mode:'list', street:'Новопокровская 37'});
  assert.deepEqual(split, {mode:'list', street:'Новопокровская', house:'37'});
  const fixed = await tools.query_tickets(split);
  assert.equal(fixed.data.matched, 1);
  assert.equal(fixed.data.tickets[0].id, 't-a1');
  assert.equal(fixed.data.tickets[0].street, 'Вул Новопокровська');
  assert.equal(fixed.data.tickets[0].house, '37');
  /* F: projection — structured parts filled => address not empty */
  assert.equal(fixed.data.tickets[0].address, 'Ясний, Вул Новопокровська 37');

  /* the same row through the UA spelling */
  const ua = await tools.query_tickets(hygieneArgs('query_tickets', {mode:'list', street:'Новопокровська 37'}));
  assert.equal(ua.data.matched, 1);
  assert.equal(ua.data.tickets[0].id, 't-a1');
});

/* ================= B: apartment numbers ================= */

test('B: four sentence shapes give the same structured result, five apartment shapes the same row', async () => {
  const rows = [
    gasRow('t-b1', {type:'Підключення', city:'Таромское', street:'Вул Привокзальна', house:'3б', apartment:'1'}),
    gasRow('t-b2', {type:'Підключення', city:'Таромское', street:'Вул Привокзальна', house:'3б', apartment:'2'})
  ];
  const tools = toolsFrom(rows);

  for(const street of ['Привокзальная 3Б', 'Привокзальна 3б', 'Вул Привокзальна 3Б', 'вул. Привокзальна 3б']){
    const args = hygieneArgs('query_tickets', {mode:'list', street});
    const out = await tools.query_tickets(args);
    assert.equal(out.data.matched, 2, street + ' resolves the house');
    assert.equal(out.data.tickets[0].house, '3б', street + ' → house is a separate field');
  }

  /* the apartment forms the model produced in production */
  for(const apartment of ['1', 'кв. 1', 'кв.1', 'квартира 1', 'КВ 1']){
    const args = hygieneArgs('query_tickets', {mode:'list', street:'Привокзальна 3б', apartment});
    assert.equal(args.apartment, '1', apartment + ' → canonical apartment');
    const out = await tools.query_tickets(args);
    assert.equal(out.data.matched, 1, apartment + ' selects exactly one apartment');
    assert.equal(out.data.tickets[0].id, 't-b1');
  }
  /* without hygiene the pre-formatted apartment silently matched nothing */
  const raw = await tools.query_tickets({mode:'list', street:'Привокзальна 3б', apartment:'кв. 1'});
  assert.equal(raw.data.matched, 0);
  assert.equal(normalizeApartment('квартира 1'), normalizeApartment('1'));
});

/* ================= C: settlement prefixes ================= */

test('C: six settlement spellings select the same rows, real names are untouched', async () => {
  const rows = [
    gasRow('t-c1', {type:'Ремонт', city:'Шевченко', street:'Вул Садова', house:'1'}),
    gasRow('t-c2', {type:'Ремонт', city:'Шевченко', street:'Вул Садова', house:'2'}),
    gasRow('t-c3', {type:'Ремонт', city:'Счастливое', street:'Вул Мирная', house:'3'})
  ];
  const tools = toolsFrom(rows);
  const forms = ['Шевченко', 'посёлок Шевченко', 'поселок Шевченко', 'село Шевченко', 'смт Шевченко', 'с. Шевченко'];
  for(const city of forms){
    const args = hygieneArgs('query_tickets', {mode:'list', city});
    assert.equal(args.city, 'Шевченко', city + ' → canonical settlement name');
    const out = await tools.query_tickets(args);
    assert.deepEqual((out.data.tickets || []).map(function(t){ return t.id; }), ['t-c1', 't-c2'], city);
  }
  const raw = await tools.query_tickets({mode:'list', city:'посёлок Шевченко'});
  assert.equal(raw.data.matched, 0, 'the prefix alone used to break the filter');
  /* real names that merely start with the same letters are never stripped */
  assert.equal(normalizeCityArg('Счастливое'), 'Счастливое');
  assert.equal(normalizeCityArg('Підгородне'), 'Підгородне');
  assert.equal(normalizeCityArg('Селище'), 'Селище');
});

/* ================= D: word ordinals ================= */

test('D: word ordinals resolve against the active list and the selection survives the follow-up', async () => {
  const seen = [];
  const tools = {
    get_ticket: async function(args){ seen.push(args.ticket_id); return {ok:true, data:{found:true, ticket:{id:args.ticket_id}}}; }
  };
  const set = createResultSet([
    {id:'t-d1', date:'01.06.2026', time:'10:00', city:'Таромское', street:'Вул Кобзаря', house:'1'},
    {id:'t-d2', date:'02.06.2026', time:'10:00', city:'Таромское', street:'Вул Кобзаря', house:'2'},
    {id:'t-d3', date:'03.06.2026', time:'10:00', city:'Таромское', street:'Вул Кобзаря', house:'3'},
    {id:'t-d4', date:'04.06.2026', time:'10:00', city:'Таромское', street:'Вул Кобзаря', house:'4'}
  ], 4, 'chat-session-1', Date.parse('2026-09-20T12:00:00Z')).resultSet;

  for(const phrase of ['открой вторую заявку', 'дай карточку второй', 'карточку номер два', 'картку номер два', 'покажи другу заявку', 'покажи вторую']){
    seen.length = 0;
    const out = await createAskOrchestrator({groq:groq([done()]), tools, toolDefs:TOOL_DEFINITIONS})
      .handle(phrase, {chatSessionId:'chat-session-1', resultSet:set, now:new Date('2026-09-20T12:00:01Z')});
    assert.deepEqual(seen, ['t-d2'], phrase + ' reads the second id of the set');
    assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'t-d2'}, phrase);
  }

  /* the follow-up must not ask again: the selection is the same ticket */
  const follow = groq([done()]);
  const second = await createAskOrchestrator({groq:follow, tools, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой карточку абонента', {chatSessionId:'chat-session-1', selectedTicketId:'t-d2'});
  assert.deepEqual(second.presentation, {kind:'single_ticket', ticket_id:'t-d2'});
  assert.equal(follow.calls, 0, 'a card of the already selected ticket needs no model');
});

/* ================= E: F4 on the turn's own authoritative list ================= */

test('E: an open turn opens the ONE exact row of its own list, a list request stays a list', async () => {
  const rows = [
    gasRow('t-k15', {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house:'15'}),
    gasRow('t-k15a', {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house:'15а'}),
    gasRow('t-k152', {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house:'15/2'}),
    gasRow('t-k17', {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house:'17'})
  ];
  const real = toolsFrom(rows);
  const tools = {
    query_tickets: async function(args){ return real.query_tickets(args); },
    get_ticket: async function(args){ return {ok:true, data:{found:true, ticket:{id:args.ticket_id}}}; }
  };
  const listArgs = {mode:'list', city:'Таромское', street:'Кобзаря'};

  /* open: exactly one row is Кобзаря 15 → that single card, no «similar» list */
  const open = await createAskOrchestrator({groq:groq([call('query_tickets', listArgs), done('Открываю заявку Кобзаря 15.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой заявку Кобзаря 15', {chatSessionId:'chat-session-1'});
  assert.deepEqual(open.presentation, {kind:'single_ticket', ticket_id:'t-k15'});
  assert.equal(open.selectedTicketId, 't-k15');
  assert.equal(open.tickets.length, 0, 'the other three rows never reach the UI');
  assert.equal(open.resultItems.length, 0);
  assert.equal(open.resultSetStatus.reason, 'selected_ticket');

  /* list: «Покажи заявки …» is a list request and keeps all four rows */
  const list = await createAskOrchestrator({groq:groq([call('query_tickets', listArgs), done('Нашёл 4 заявки.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи заявки Кобзаря 15', {chatSessionId:'chat-session-1'});
  assert.equal(list.presentation, null);
  assert.equal(list.resultItems.length, 4);
  assert.equal(list.total, 4);
  assert.equal(list.resultSet.ticketIds.length, 4);

  /* zero exact rows: the list stays, nothing is guessed */
  const zero = await createAskOrchestrator({groq:groq([call('query_tickets', listArgs), done('Точной заявки нет.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой заявку Кобзаря 19', {chatSessionId:'chat-session-1'});
  assert.equal(zero.presentation, null, 'no guess when no row matches');
  assert.equal(zero.resultItems.length, 4);

  /* money is not a house: «за 1500 грн» never becomes house 1500 */
  const money = await createAskOrchestrator({groq:groq([call('query_tickets', listArgs), done('Вот список.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой заявку Кобзаря за 1500 грн', {chatSessionId:'chat-session-1'});
  assert.equal(money.presentation, null);
  assert.equal(money.resultItems.length, 4);
});

test('E2: two exact rows are never resolved by guessing, even on an authoritative turn', async () => {
  const rows = [
    gasRow('t-x1', {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house:'15', apartment:'1'}),
    gasRow('t-x2', {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house:'15', apartment:'2'}),
    gasRow('t-x3', {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house:'17'})
  ];
  const real = toolsFrom(rows);
  const tools = {query_tickets: async function(args){ return real.query_tickets(args); }};
  const out = await createAskOrchestrator({groq:groq([call('query_tickets', {mode:'list', city:'Таромское', street:'Кобзаря'}), done('Вот похожие заявки.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой заявку Кобзаря 15', {chatSessionId:'chat-session-1'});
  assert.equal(out.presentation, null, 'two matching houses → the master picks, the code never guesses');
  assert.equal(out.selectedTicketId, null);
  assert.equal(out.resultItems.length, 3);
});

/* ================= F: one address projection ================= */

test('F: structured parts always produce a non-empty address line', () => {
  assert.equal(buildAddressLine({city:'Ясний', street:'Вул Новопокровська', house:'37'}), 'Ясний, Вул Новопокровська 37');
  assert.equal(buildAddressLine({city:'Таромское', street:'Вул Привокзальна', house:'3б', apartment:'1'}), 'Таромское, Вул Привокзальна 3б, кв. 1');
  /* legacy row without structured parts keeps its own text */
  assert.equal(buildAddressLine({address:'Вул Садова 3'}), 'Вул Садова 3');
  /* the raw field is never duplicated when the structured parts already say it */
  assert.equal(buildAddressLine({city:'Ясний', street:'Вул Новопокровська', house:'37', address:'Вул Новопокровська 37'}), 'Ясний, Вул Новопокровська 37');
  assert.equal(buildAddressLine({}), '');
});

/* ================= G: negatives + additive meta ================= */

test('G: money, dates, counts and address contexts never become ordinals or houses', async () => {
  for(const phrase of ['два часа назад', 'два роутера', 'пять заявок', '1500 грн', '12 сентября', 'дом два']){
    assert.equal(detectExplicitOrdinal(phrase), null, phrase);
  }
  /* a bare quantity is still not an ordinal (released F2 behaviour) */
  assert.equal(detectExplicitOrdinal('Покажи 5 карточек'), null);
  assert.equal(detectExplicitOrdinal('Покажи карточку 5').index, 5);
  assert.equal(detectExplicitOrdinal('Покажи 2-ю').index, 2, 'digit ordinals keep working');

  for(const value of ['Садовая 1500', 'Лесная 5 грн', 'Садовая 12 сентября', 'Садовая', '-20', 'вул 3', '5 заявок по Садовой']){
    assert.equal(splitStreetHouse(value), null, value);
    assert.equal(hygieneArgs('query_tickets', {street:value}).street, value, value + ' stays as the model sent it');
  }
  /* an explicitly given house is never overwritten by the tail */
  assert.deepEqual(hygieneArgs('query_tickets', {street:'Привокзальная 3Б', house:'3/14'}), {street:'Привокзальная', house:'3/14'});
  /* tools without address arguments are left untouched */
  assert.deepEqual(hygieneArgs('search_tickets', {terms:['Роутер 1500']}), {terms:['Роутер 1500']});
});

test('G2: snapshot freshness is additive and absent on a direct GAS read', async () => {
  const rows = [gasRow('t-m1', {type:'Ремонт', city:'Ясний', street:'Вул Новопокровська', house:'37'})];
  const savedAt = Date.parse('2026-09-20T10:00:00Z');
  const cache = {age_ms:1000, stale:false};
  const snap = toolsFrom(rows, {savedAt, cache});
  const gas = toolsFrom(rows);

  const q = await snap.query_tickets({mode:'list', street:'Новопокровська'});
  assert.equal(q.data.data_as_of, '2026-09-20T10:00:00.000Z');
  assert.deepEqual(q.data.snapshot_cache, cache);
  for(const [name, args] of [['list_tickets', {limit:5}], ['find_tickets_by_address', {address:'Шевченко'}], ['get_tickets_by_date', {date:'10.06.2026'}], ['get_shifts', {}], ['get_reports', {date_from:'01.06.2026', date_to:'30.06.2026'}], ['get_statistics', {period:'month'}], ['list_places', {}]]){
    const out = await snap[name](args);
    assert.equal(out.ok, true, name);
    assert.equal(out.data.data_as_of, '2026-09-20T10:00:00.000Z', name + ' carries data_as_of');
    assert.deepEqual(out.data.snapshot_cache, cache, name + ' carries snapshot_cache');
  }
  /* direct GAS read: the fields stay absent, so old clients see no change */
  const plain = await gas.list_tickets({limit:5});
  assert.equal(plain.data.data_as_of, undefined);
  assert.equal(plain.data.snapshot_cache, undefined);
  assert.equal(plain.ok, true);
  /* get_ticket is a live GAS read by definition — no freshness claim */
  assert.equal(TOOL_DEFINITIONS.find(function(def){ return def.name === 'get_ticket'; }).inputSchema.required[0], 'ticket_id');
});

/* ================= wiring: the orchestrator hygienises model arguments ================= */

test('wiring: the tool receives the hygienised arguments, the phrase keeps its meaning', async () => {
  const seen = [];
  const tools = {
    query_tickets: async function(args){
      seen.push(args);
      return {ok:true, data:{mode:'list', resolved_filters:args, matched:1, total_matched:1, tickets:[{id:'t-w1', date:'10.06.2026', city:'Таромское', street:'Вул Привокзальна', house:'3б', address:'Таромское, Вул Привокзальна 3б'}]}};
    }
  };
  const out = await createAskOrchestrator({
    groq:groq([call('query_tickets', {mode:'list', city:'посёлок Шевченко', street:'Привокзальная 3Б', apartment:'кв. 1'}), done('Вот заявка.')]),
    tools, toolDefs:TOOL_DEFINITIONS
  }).handle('Покажи заявку Привокзальная 3Б кв. 1 в посёлке Шевченко', {chatSessionId:'chat-session-1'});
  assert.deepEqual(seen, [{mode:'list', city:'Шевченко', street:'Привокзальная', house:'3Б', apartment:'1'}]);
  assert.equal(out.ok, true);
});
