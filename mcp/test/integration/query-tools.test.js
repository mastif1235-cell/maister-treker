/* Integration tests for the v91.44 smart-query tools (query_tickets and
   list_catalog) through the real READ tool layer. Covers the production
   regression matrix: router@1500 semantics, Миколаївка 1 streets/houses,
   standalone-query isolation, full-set aggregates, phone suffix, coworker
   evidence, invalid dates, ambiguity, privacy and UUID-free projections. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createReadTools, createDataPipeline} from '../../src/tools/read.js';
import {assertNoForbidden} from '../../src/gas/mappers.js';

function row(id, date, fullData, extra){
  return Object.assign({id, date, time:'10:00', content:'', sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify(fullData)}, extra || {});
}

function toolsFrom(rows, shifts){
  const pipeline = createDataPipeline({getList:async function(){ return {ok:true, data:{tickets:rows, shifts:shifts || []}}; }});
  return createReadTools({data:pipeline});
}

/* ---------- the real production ticket: router@1500 breakdown ---------- */

test('production case: router at 1500 inside a 1600 ticket is found by item price, not ticket sum', async () => {
  const production = row('router-1500', '28.08.2026', {
    city:'Таромське', street:'Вул Футбольна', house:'39', type:'Ремонт',
    payment:'Готівка', signal:'-17',
    equipment:[{label:'Роутер', price:1500}],
    presetWorks:[{label:'Пайка оптики', price:100, qty:1}]
  }, {sum:1600, time:'11:59', content:'Сигнал: -17'});
  const other = row('router-600', '28.08.2026', {
    city:'Таромське', street:'Інша', house:'1',
    equipment:[{label:'Роутер', price:600}]
  }, {sum:700});
  const tools = toolsFrom([production, other]);

  const august = await tools.query_tickets({mode:'count', items:[{text:'роутер', unit_price:1500}], date_from:'01.08.2026', date_to:'31.08.2026'});
  assert.equal(august.ok, true);
  assert.equal(august.data.matched, 1, 'the router@1500 ticket is found despite sum=1600');
  assert.equal(august.data.item_totals.quantity, 1);
  assert.equal(august.data.item_totals.sum, 1500);

  const negative = await tools.query_tickets({mode:'count', items:[{text:'роутер', unit_price:1200}]});
  assert.equal(negative.data.matched, 0);

  /* a different work priced 1500 must NOT satisfy router@1500 */
  const tricky = row('tricky', '29.08.2026', {
    equipment:[{label:'Роутер', price:1200}],
    additionalWork:[{desc:'Термінова робота', sum:1500}]
  }, {sum:2700});
  const tools2 = toolsFrom([tricky]);
  const mixed = await tools2.query_tickets({mode:'count', items:[{text:'роутер', unit_price:1500}]});
  assert.equal(mixed.data.matched, 0, 'router@1200 + unrelated work@1500 is NOT router@1500');
});

test('router AND connector is a true intersection on one ticket', async () => {
  const both = row('both', '10.08.2026', {city:'Таромське', street:'А', equipment:[{label:'Роутер', price:1500}], presetWorks:[{label:'Заміна коннектора', price:50, qty:1}]});
  const routerOnly = row('r', '11.08.2026', {city:'Таромське', street:'Б', equipment:[{label:'Роутер', price:600}]});
  const connectorOnly = row('c', '12.08.2026', {city:'Таромське', street:'В', presetWorks:[{label:'Заміна коннектора', price:50, qty:1}]});
  const tools = toolsFrom([both, routerOnly, connectorOnly]);
  const result = await tools.query_tickets({mode:'list', items:[{text:'роутер'}, {text:'коннектор'}]});
  assert.equal(result.data.matched, 1);
  assert.equal(result.data.tickets[0].id, 'both');
});

/* ---------- Миколаївка 1: standalone street/house sets are complete ---------- */

const MYKOLAIVKA_STREETS = ['Вул Садова', 'Вул Генерала Пушкіна', 'Вул Центральна', 'Педагогічна', 'Вул Виноградна', 'Вул Криворізька', "П'ятихатки"];

function mykolaivkaRows(){
  const rows = [];
  MYKOLAIVKA_STREETS.forEach(function(street, i){
    rows.push(row('mk-' + i, '0' + (1 + (i % 9)) + '.09.2026', {city:'Миколаївка 1', street, house:String(10 + i), signal:i < 3 ? '-27' : '-20'}, {time:'10:0' + i}));
  });
  /* Садова gets extra houses to prove the FULL unique house set */
  ['3', '7', '12'].forEach(function(house, i){
    rows.push(row('mk-sad-' + i, '05.09.2026', {city:'Миколаївка 1', street:'Вул Садова', house, signal:'-26'}));
  });
  /* a distractor city with a Садова of its own */
  rows.push(row('mk2', '05.09.2026', {city:'Миколаївка 2', street:'Вул Садова', house:'99'}));
  return rows;
}

test('regression: signal query followed by standalone Миколаївка 1 street query does not inherit the signal filter', async () => {
  const tools = toolsFrom(mykolaivkaRows());
  /* Query 1: the previous question */
  const q1 = await tools.query_tickets({mode:'list', signal_worse_than:-25});
  assert.equal(q1.data.matched, 6, '3 streets with -27 plus 3 extra Садова visits at -26');
  /* Query 2: NEW standalone question — fresh filters only */
  const q2 = await tools.query_tickets({mode:'group', group_by:'street', city:'Миколаївка 1'});
  assert.equal(q2.data.matched, 10, 'Миколаївка 2 must not bleed into Миколаївка 1');
  const keys = q2.data.groups.map(function(g){ return g.key; }).sort();
  assert.deepEqual(keys, MYKOLAIVKA_STREETS.slice().sort(), 'complete street set, nothing filtered away');
  /* The engine is stateless: q1 must not have mutated anything for q2 */
  assert.equal(q2.data.resolved_filters.signal_worse_than, undefined);
});

test('regression: Садова in Миколаївка 1 returns the full unique house set', async () => {
  const tools = toolsFrom(mykolaivkaRows());
  const houses = await tools.query_tickets({mode:'group', group_by:'house', city:'Миколаївка 1', street:'садова'});
  assert.equal(houses.data.ambiguous, false);
  const keys = houses.data.groups.map(function(g){ return g.key; }).sort();
  assert.deepEqual(keys, ['10', '12', '3', '7'], 'full unique house set incl. all repeat visits, no cross-city bleed');
  assert.equal(houses.data.groups.reduce(function(s, g){ return s + g.count; }, 0), 4);
  const exists = await tools.query_tickets({mode:'exists', city:'Миколаївка 1', street:'садова', house:'12'});
  assert.equal(exists.data.exists, true);
});

test('exists/count modes stay at the question granularity', async () => {
  const tools = toolsFrom(mykolaivkaRows());
  const exists = await tools.query_tickets({mode:'exists', city:'Миколаївка 1', street:'мостова'});
  assert.equal(exists.data.exists, false);
  assert.equal(exists.data.matched, 0);
});

/* ---------- aggregation independence from pagination ---------- */

test('equipment aggregation and groups are independent of pagination caps', async () => {
  const rows = Array.from({length:75}, function(_, i){
    return row('bulk-' + i, '01.08.2026', {
      city:i % 2 ? 'Таромське' : 'Карнаухівка', street:'Вулиця ' + (i % 5),
      equipment:[{label:'Роутер', price:1500}]
    }, {sum:1500});
  });
  const tools = toolsFrom(rows);
  const count = await tools.query_tickets({mode:'count', items:[{text:'роутер', unit_price:1500}], limit:10});
  assert.equal(count.data.matched, 75, 'total=75 even when the page cap is 10');
  assert.equal(count.data.item_totals.quantity, 75);
  const group = await tools.query_tickets({mode:'group', group_by:'city', items:[{text:'роутер'}], limit:2});
  assert.equal(group.data.groups.reduce(function(s, g){ return s + g.count; }, 0), 75);
  const stats = await tools.query_tickets({mode:'stats', items:[{text:'роутер'}], limit:2});
  assert.equal(stats.data.stats.total, 75 * 1500);
});

/* ---------- identifiers: phone suffix / contract / MAC ---------- */

test('phone suffix lookup finds the ticket without echoing the number', async () => {
  const rows = [
    row('phone-1', '15.08.2026', {city:'Таромське', street:'Вул Лісова', house:'4', phone:'+380 67 123 48 63'}),
    row('phone-2', '16.08.2026', {city:'Дніпро', street:'Інша', house:'1', phone:'0509998877', extraPhones:['0931114863']})
  ];
  const tools = toolsFrom(rows);
  const result = await tools.query_tickets({mode:'list', phone_digits:'4863'});
  assert.equal(result.data.matched, 2);
  assert.deepEqual(result.data.tickets.map(function(t){ return t.id; }).sort(), ['phone-1', 'phone-2']);
  const serialized = JSON.stringify(result.data);
  assert.ok(!serialized.includes('0671234863'), 'full phone never leaves the worker');
  assert.ok(!serialized.includes('123 48 63'));
  assert.equal(result.data.resolved_filters.phone_digits.length, 4, 'only the suffix length is echoed');
  const short = await tools.query_tickets({mode:'list', phone_digits:'63'});
  assert.equal(short.ok, false, '<3 digits rejected');
});

test('contract and MAC partial lookup', async () => {
  const rows = [
    row('c1', '15.08.2026', {city:'Дніпро', contractNumber:'Д-1488', macAddress:'AA:BB:CC:11:22:33'})
  ];
  const tools = toolsFrom(rows);
  const byContract = await tools.query_tickets({mode:'list', contract:'1488'});
  assert.equal(byContract.data.matched, 1);
  const byMac = await tools.query_tickets({mode:'list', mac:'cc:11:22'});
  assert.equal(byMac.data.matched, 1);
});

/* ---------- coworkers & shifts ---------- */

test('coworker + period: direct vs shift-only evidence and honest wording', async () => {
  const rows = [
    row('w-direct', '25.08.2026', {city:'Таромське', street:'А', connectMasters:['Женя'], equipment:[{label:'Роутер', price:1500}]}),
    row('w-shift', '26.08.2026', {city:'Таромське', street:'Б'}),
    row('w-none', '27.08.2026', {city:'Таромське', street:'В'})
  ];
  const shifts = [
    {id:'s1', date:'25.08.2026', hours:8, coworker:'Женя'},
    {id:'s2', date:'26.08.2026', hours:9, coworker:'Жека'},
    {id:'s3', date:'27.08.2026', hours:8, coworker:'Олег'}
  ];
  const tools = toolsFrom(rows, shifts);
  const result = await tools.query_tickets({mode:'list', coworker:'Жека', date_from:'01.08.2026', date_to:'31.08.2026'});
  assert.deepEqual(result.data.tickets.map(function(t){ return t.id; }).sort(), ['w-direct', 'w-shift']);
  const direct = result.data.tickets.find(function(t){ return t.id === 'w-direct'; });
  const shiftOnly = result.data.tickets.find(function(t){ return t.id === 'w-shift'; });
  assert.ok(direct.match_reasons.join(' ').includes('структурно'));
  assert.ok(shiftOnly.match_reasons.join(' ').includes('зміною того ж дня'));
  /* memory search: Жека + кінець серпня + роутер */
  const memory = await tools.query_tickets({mode:'list', coworker:'Женя', date_from:'21.08.2026', date_to:'31.08.2026', items:[{text:'роутер'}]});
  assert.equal(memory.data.matched, 1);
  assert.equal(memory.data.tickets[0].id, 'w-direct');
});

/* ---------- approximate periods & date handling ---------- */

test('approximate «кінець серпня» windows are deterministic and exposed in resolved_filters', async () => {
  const rows = [
    row('late-aug', '28.08.2026', {city:'Таромське', equipment:[{label:'Роутер', price:1500}]}),
    row('early-aug', '05.08.2026', {city:'Таромське', equipment:[{label:'Роутер', price:1500}]})
  ];
  const tools = toolsFrom(rows);
  /* Deterministic documented window for «конец/кінець місяця» = 21..31 */
  const result = await tools.query_tickets({mode:'list', items:[{text:'роутер'}], date_from:'21.08.2026', date_to:'31.08.2026'});
  assert.equal(result.data.matched, 1);
  assert.equal(result.data.tickets[0].id, 'late-aug');
  assert.equal(result.data.resolved_filters.date_from, '21.08.2026');
  assert.equal(result.data.resolved_filters.date_to, '31.08.2026');
});

test('invalid calendar dates are rejected, not searched', async () => {
  const tools = toolsFrom([row('x', '28.02.2026', {city:'Дніпро'})]);
  const bad = await tools.query_tickets({mode:'list', date_from:'31.02.2026'});
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'INVALID_INPUT');
  const bad2 = await tools.query_tickets({mode:'list', date_to:'29.02.2025'});
  assert.equal(bad2.ok, false);
  const badFormat = await tools.query_tickets({mode:'list', date_from:'2026-08-01'});
  assert.equal(badFormat.ok, false);
});

/* ---------- ambiguity, nonexistent items, legacy evidence ---------- */

test('nonexistent item returns zero matches with an honest catalog note', async () => {
  const tools = toolsFrom([row('x', '28.08.2026', {city:'Дніпро', equipment:[{label:'Роутер', price:1500}]})]);
  const catalog = await tools.list_catalog();
  assert.ok(!catalog.data.equipment.some(function(e){ return e.label === 'Муфта'; }));
  const result = await tools.query_tickets({mode:'list', items:[{text:'муфта'}]});
  assert.equal(result.data.matched, 0);
  assert.ok(result.data.notes.some(function(n){ return n.includes('не знайдена'); }));
});

test('legacy text-only item evidence is marked as legacy', async () => {
  const legacy = {id:'legacy-1', date:'01.07.2025', time:'10:00', content:'Поставили роутер клиенту, старый текст без структуры', sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify({})};
  const tools = toolsFrom([legacy]);
  const result = await tools.query_tickets({mode:'list', items:[{text:'роутер'}]});
  assert.equal(result.data.matched, 1);
  assert.ok(result.data.tickets[0].match_reasons.join(' ').includes('legacy'));
});

test('same street name in two cities is reported ambiguous, not guessed', async () => {
  const rows = [
    row('a', '01.08.2026', {city:'Таромське', street:'Мостова'}),
    row('b', '02.08.2026', {city:'Карнаухівка', street:'Мостова'})
  ];
  const tools = toolsFrom(rows);
  const result = await tools.query_tickets({mode:'list', street:'мостова'});
  assert.equal(result.data.ambiguous, true);
  assert.deepEqual(result.data.candidates.map(function(c){ return c.city; }).sort(), ['Карнаухівка', 'Таромське']);
});

/* ---------- privacy / projection shape ---------- */

test('query rows never carry notes, phones or coordinates; UUID-free by contract', async () => {
  const rows = [{
    id:'754b3b66-secret', date:'28.08.2026', time:'11:59', content:'PRIVATE_CONTENT_MARKER', sum:1600, tags:[],
    backupNote:'PRIVATE_MASTER_NOTE_SECRET',
    fullDataJson:JSON.stringify({
      city:'Таромське', street:'Вул Футбольна', house:'39', type:'Ремонт',
      phone:'0671234567', contractNumber:'Д-9', note:'приватна нотатка',
      geoLink:'https://maps.google.com/?q=48.464,35.046',
      equipment:[{label:'Роутер', price:1500}]
    })
  }];
  const tools = toolsFrom(rows);
  const result = await tools.query_tickets({mode:'list', city:'Таромське'});
  assertNoForbidden(result.data);
  const serialized = JSON.stringify(result.data);
  assert.ok(!serialized.includes('PRIVATE_CONTENT_MARKER'));
  assert.ok(!serialized.includes('PRIVATE_MASTER_NOTE_SECRET'));
  assert.ok(!serialized.includes('приватна нотатка'));
  assert.ok(!serialized.includes('0671234567'));
  assert.ok(!serialized.includes('48.464'), 'coordinates never reach the query result');
  assert.equal(result.data.tickets[0].has_geo, true, 'only the boolean fact travels');
  /* id is present ONLY for the client-side open action; ordinary numbering
     for the model is the ord field (1, 2, 3...) */
  assert.equal(result.data.tickets[0].ord, 1);
});

test('signal stats cover only parsed signals and say so (coverage honesty)', async () => {
  const rows = [
    row('s1', '01.08.2026', {signal:'-26', city:'Таромське'}),
    row('s2', '02.08.2026', {signal:'-18', city:'Таромське'}),
    row('s3', '03.08.2026', {city:'Таромське'})
  ];
  const tools = toolsFrom(rows);
  const stats = await tools.query_tickets({mode:'stats', city:'Таромське'});
  assert.equal(stats.data.stats.signal.parsed, 2);
  assert.equal(stats.data.stats.signal.missing, 1);
  assert.equal(stats.data.stats.signal.avg, -22);
  assert.equal(stats.data.stats.signal.worst, -26);
  assert.equal(stats.data.coverage.signals_parsed, 2);
});

/* ---------- tool exposure through the MCP surface ---------- */

test('query_tickets and list_catalog are served through the RPC surface', async () => {
  const {makeApp, toolCall, toolData} = await import('../helpers/mcpapp.js');
  const app = await makeApp();
  const count = toolData((await toolCall(app, 'query_tickets', {mode:'count'})).result);
  assert.equal(count.matched, 5, 'BASE fixture: 5 tickets counted deterministically');
  const list = toolData((await toolCall(app, 'query_tickets', {mode:'list', city:'Дніпро'})).result);
  assert.equal(list.matched, 5);
  assert.ok(list.tickets.every(function(t){ return typeof t.ord === 'number'; }));
  const catalog = toolData((await toolCall(app, 'list_catalog', {})).result);
  assert.ok(Array.isArray(catalog.equipment));
  assert.ok(catalog.equipment.some(function(e){ return e.label === 'Роутер'; }));
  assert.ok(catalog.equipment.some(function(e){ return e.label === 'ONU'; }));
});
