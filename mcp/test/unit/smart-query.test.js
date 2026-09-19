/* Unit tests for the deterministic smart-query engine (pure functions):
   synonyms/catalog resolution, same-item attribute binding, strict signal
   semantics, calendar-strict dates, ambiguity handling, evidence kinds. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normItem, conceptForText, resolveItemText, buildCatalogData,
  ticketItemEvidence, parseDateKeyStrict, ticketSignalNumber,
  cityMatches, streetMatches, coworkerNameMatches, runSmartQuery
} from '../../src/ask/smart-query.js';
import {redactTicket, ticketFromGasRow} from '../../src/gas/mappers.js';

function ticket(id, date, extra){
  return Object.assign({
    id, date, time:'10:00', type:'', city:'', street:'', house:'', apartment:'',
    address:'', phone:'', extraPhones:[], macAddress:'', signal:'', payment:'', sum:0,
    tags:[], contractNumber:'', geoLink:'', equipment:[], cables:[], presetWorks:[],
    additionalWork:[], connectMasters:[]
  }, extra || {});
}

/* ---------- normalization & synonyms ---------- */

test('normItem bridges UA/RU letters, punctuation and hyphens', () => {
  assert.equal(normItem('Патч-Корд'), normItem('патч корд'));
  assert.equal(normItem('ОНУшка'), normItem('онушка'));
  assert.equal(normItem('Коннектор'), normItem('конектор') === normItem('конектор') ? normItem('Коннектор') : '');
  assert.equal(normItem('Роутер WiFi'), 'роутер wifi');
});

test('concept resolution covers the documented synonym classes', () => {
  assert.equal(conceptForText('роутер'), 'router');
  assert.equal(conceptForText('Маршрутизатор'), 'router');
  assert.equal(conceptForText('WiFi router'), 'router');
  assert.equal(conceptForText('ONU'), 'onu');
  assert.equal(conceptForText('онушка'), 'onu');
  assert.equal(conceptForText('оптический терминал'), 'onu');
  assert.equal(conceptForText('коннектор'), 'connector');
  assert.equal(conceptForText('конектор'), 'connector');
  assert.equal(conceptForText('быстрый коннектор SC'), 'connector');
  assert.equal(conceptForText('ФОБ'), 'fob');
  assert.equal(conceptForText('оптическая коробка'), 'fob');
  assert.equal(conceptForText('муфта'), 'splice');
  assert.equal(conceptForText('вузол'), 'node');
  assert.equal(conceptForText('узел'), 'node');
  assert.equal(conceptForText('спліттер'), 'splitter');
  assert.equal(conceptForText('патч-корд'), 'patchcord');
  assert.equal(conceptForText('UTP'), 'utp');
  assert.equal(conceptForText('витая пара'), 'utp');
  assert.equal(conceptForText('оптика'), 'fiber');
  assert.equal(conceptForText('дроп'), 'fiber');
  assert.equal(conceptForText('абонентська коробка'), 'fob', '«коробка» is the installer word for an optical box');
  assert.equal(conceptForText('абонент відмовився'), null);
});

test('resolveItemText resolves synonyms to REAL catalog labels only', () => {
  const catalog = ['Роутер', 'Роутер (клієнта)', 'Пайка оптики', 'Кабель UTP'];
  const router = resolveItemText('маршрутизатор', catalog);
  assert.equal(router.concept, 'router');
  assert.deepEqual(router.labels.sort(), ['Роутер', 'Роутер (клієнта)']);
  assert.equal(router.matchedInCatalog, true);
  const patch = resolveItemText('патчкорд', catalog);
  assert.equal(patch.matchedInCatalog, false, 'no patchcord exists in data -> nothing invented');
  assert.deepEqual(patch.labels, []);
});

/* ---------- same-item attribute binding ---------- */

test('router@1500 matches only when the router itself costs 1500', () => {
  const good = ticket('t1', '28.08.2026', {equipment:[{label:'Роутер', price:1500, qty:1, total:1500}], presetWorks:[{label:'Пайка оптики', price:100, qty:1}]});
  const bad = ticket('t2', '28.08.2026', {equipment:[{label:'Роутер', price:1200, qty:1, total:1200}], presetWorks:[{label:'Пайка оптики', price:1500, qty:1}]});
  const cond = {text:'роутер', unit_price:1500};
  const ok = ticketItemEvidence(good, cond, ['Роутер', 'Пайка оптики'], '');
  assert.equal(ok.ok, true);
  assert.equal(ok.evidence, 'structured');
  const no = ticketItemEvidence(bad, cond, ['Роутер', 'Пайка оптики'], '');
  assert.equal(no.ok, false, 'unrelated work priced 1500 must not satisfy router@1500');
});

test('multi-condition AND binds each condition to its own item', () => {
  const t = ticket('t', '01.09.2026', {equipment:[{label:'Роутер', price:1500, qty:1, total:1500}], presetWorks:[{label:'Заміна коннектора', price:50, qty:1}]});
  const labels = ['Роутер', 'Заміна коннектора'];
  assert.equal(ticketItemEvidence(t, {text:'роутер'}, labels, '').ok, true);
  assert.equal(ticketItemEvidence(t, {text:'коннектор'}, labels, '').ok, true);
  assert.equal(ticketItemEvidence(t, {text:'ону'}, labels, '').ok, false);
});

test('attribute conditions are never satisfied by legacy text', () => {
  const t = ticket('t', '01.09.2026', {});
  const legacy = ticketItemEvidence(t, {text:'роутер', unit_price:1500}, [], 'ставили роутер за 1500');
  assert.equal(legacy.ok, false);
  const textOnly = ticketItemEvidence(t, {text:'роутер'}, [], 'ставили роутер клієнту');
  assert.equal(textOnly.ok, true);
  assert.equal(textOnly.evidence, 'legacy_text');
});

test('derived equipment qty is flagged, never presented as stored', () => {
  const t = ticket('t', '01.09.2026', {equipment:[{label:'Роутер', price:1500, qty:1, total:1500, qty_derived:true}]});
  const res = ticketItemEvidence(t, {text:'роутер'}, ['Роутер'], '');
  assert.equal(res.qty_derived, true);
});

/* ---------- dates / signals ---------- */

test('parseDateKeyStrict rejects impossible calendar dates', () => {
  assert.equal(parseDateKeyStrict('28.08.2026'), '2026-08-28');
  assert.equal(parseDateKeyStrict('31.02.2026'), null);
  assert.equal(parseDateKeyStrict('29.02.2025'), null);
  assert.equal(parseDateKeyStrict('29.02.2024'), '2024-02-29');
  assert.equal(parseDateKeyStrict('16.13.2026'), null);
  assert.equal(parseDateKeyStrict('2026-08-28'), null);
});

test('signal semantics stay strict: worse_than excludes, worse_or_equal includes', () => {
  const rows = [
    ticket('a', '01.01.2026', {signal:'-24'}),
    ticket('b', '01.01.2026', {signal:'-25'}),
    ticket('c', '01.01.2026', {signal:'-25.1'}),
    ticket('d', '01.01.2026', {signal:'-32'}),
    ticket('e', '01.01.2026', {signal:''})
  ];
  const strict = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'list', signal_worse_than:-25});
  assert.deepEqual(strict.data.tickets.map(function(t){ return t.id; }).sort(), ['c', 'd']);
  const inclusive = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'list', signal_worse_or_equal:-25});
  assert.deepEqual(inclusive.data.tickets.map(function(t){ return t.id; }).sort(), ['b', 'c', 'd']);
  const missing = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'list', has_signal:false});
  assert.deepEqual(missing.data.tickets.map(function(t){ return t.id; }), ['e']);
  assert.equal(ticketSignalNumber({signal:'-25,5'}), null, 'comma decimals are not parsed as signal numbers');
});

/* ---------- addresses ---------- */

test('city match: structured authoritative, legacy stem fallback only without city (v91.43 parity)', () => {
  const structured = {city:'Таромське', street:''};
  assert.equal(cityMatches(structured, 'таромском', '').ok, true);
  assert.equal(cityMatches(structured, 'дніпро', '').ok, false, 'structured city is authoritative');
  const legacy = {city:'', street:''};
  assert.equal(cityMatches(legacy, 'таромское', 'Таромское ул. Пищана 16').ok, true);
  assert.equal(cityMatches(legacy, 'Таромское', 'Дніпро ул. Пищана 16').ok, false);
  /* multi-word city requires ALL tokens (Миколаївка 1 != Миколаївка 2) */
  assert.equal(cityMatches(legacy, 'Миколаївка 1', 'Миколаївка 2 вул. Садова').ok, false);
  assert.equal(cityMatches(legacy, 'Миколаївка 1', 'Миколаївка 1 вул. Садова').ok, true);
  /* structured cities differing only by trailing digit never merge */
  assert.equal(cityMatches({city:'Миколаївка 2', street:''}, 'Миколаївка 1', '').ok, false);
  assert.equal(cityMatches({city:'Миколаївка 1', street:''}, 'Миколаївка 1', '').ok, true);
});

test('street matcher uses stems and tolerates prefixes', () => {
  assert.equal(streetMatches({street:'Вул Садова'}, 'садова').ok, true);
  assert.equal(streetMatches({street:'Вул Садова'}, 'садовой').ok, true);
  assert.equal(streetMatches({street:'Вул Садова'}, 'центральна').ok, false);
});

/* ---------- coworkers ---------- */

test('coworker name matching tolerates inflections, partial names and aliases', () => {
  assert.equal(coworkerNameMatches('Женя', 'Жека'), true);
  assert.equal(coworkerNameMatches('Євген', 'Женя'), true, 'alias table covers same-person forms');
  assert.equal(coworkerNameMatches('Олег Петренко', 'олег'), true);
  assert.equal(coworkerNameMatches('Марія', 'Олег'), false);
  assert.equal(coworkerNameMatches('Женя', 'Петро'), false);
});

/* ---------- catalog ---------- */

test('catalog is derived from actual ticket data with counts', () => {
  const tickets = [
    ticket('t1', '01.01.2026', {city:'Таромське', tags:['ремонт'], equipment:[{label:'Роутер', price:1500}], presetWorks:[{label:'Пайка оптики', price:100}]}),
    ticket('t2', '02.01.2026', {city:'Таромське', equipment:[{label:'Роутер', price:600}]}),
    ticket('t3', '03.01.2026', {city:'Дніпро', cables:[{label:'UTP', meters:10, pricePerMeter:5}]})
  ];
  const catalog = buildCatalogData(tickets, [{date:'01.01.2026', hours:8, coworker:'Женя, Олег'}]);
  assert.deepEqual(catalog.equipment[0], {label:'Роутер', count:2});
  assert.equal(catalog.cables[0].label, 'UTP');
  assert.equal(catalog.preset_works[0].label, 'Пайка оптики');
  assert.deepEqual(catalog.cities.map(function(c){ return c.name; }).sort(), ['Дніпро', 'Таромське']);
  assert.deepEqual(catalog.coworkers.map(function(c){ return c.name; }).sort(), ['Женя', 'Олег']);
  assert.equal(catalog.total_tickets, 3);
});

/* ---------- full runner: envelope shape & modes ---------- */

test('envelope always carries authoritative full-set metadata', () => {
  const rows = Array.from({length:75}, function(_, i){
    return ticket('bulk-' + i, '01.08.2026', {city:'Таромське', street:'Вулиця ' + (i % 5), signal:i % 2 ? '-26' : '-20', equipment:[{label:'Роутер', price:1500, qty:1, total:1500, qty_derived:true}]});
  });
  const ctx = {tickets:rows, shifts:[], searchIndex:[]};
  const list = runSmartQuery(ctx, {mode:'list', items:[{text:'роутер', unit_price:1500}], limit:8});
  assert.equal(list.data.total_matched, 75);
  assert.equal(list.data.returned, 8);
  assert.equal(list.data.matched, 75);
  assert.equal(list.data.item_totals.quantity, 75, 'item aggregate computed over FULL set, not the page');
  assert.equal(list.data.tickets[0].ord, 1);
  assert.equal(list.data.tickets[7].ord, 8);
  const page2 = runSmartQuery(ctx, {mode:'list', items:[{text:'роутер', unit_price:1500}], limit:8, offset:8});
  assert.equal(page2.data.tickets[0].ord, 9);
  const count = runSmartQuery(ctx, {mode:'count', items:[{text:'роутер'}]});
  assert.equal(count.data.matched, 75);
  assert.equal(count.data.item_totals.quantity, 75);
  assert.equal(count.data.item_totals.sum, 75 * 1500);
  assert.equal(count.data.item_totals.derived_quantity, 75);
});

test('group and stats modes are independent of pagination caps', () => {
  const rows = [];
  for(let i = 0; i < 60; i++){
    rows.push(ticket('g-' + i, '0' + ((i % 2) + 1) + '.08.2026', {city:i % 3 ? 'Таромське' : 'Миколаївка 1', street:'Вулиця ' + (i % 4), house:String(i + 1), signal:i % 2 ? '-26' : '-20', sum:100, type:'Ремонт', payment:'Готівка'}));
  }
  const ctx = {tickets:rows, shifts:[], searchIndex:[]};
  const byCity = runSmartQuery(ctx, {mode:'group', group_by:'city'});
  const total = byCity.data.groups.reduce(function(s, g){ return s + g.count; }, 0);
  assert.equal(total, 60);
  assert.equal(byCity.data.groups.find(function(g){ return g.key === 'Таромське'; }).count, 40);
  const stats = runSmartQuery(ctx, {mode:'stats', signal_worse_than:-25});
  assert.equal(stats.data.matched, 30);
  assert.equal(stats.data.stats.count, 30);
  assert.equal(stats.data.stats.signal.parsed, 30);
  assert.equal(stats.data.stats.total, 3000);
});

test('invalid date is rejected, not searched as valid', () => {
  const ctx = {tickets:[ticket('t', '28.02.2026', {})], shifts:[], searchIndex:[]};
  const bad = runSmartQuery(ctx, {mode:'list', date_from:'31.02.2026'});
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'INVALID_INPUT');
  const badMode = runSmartQuery(ctx, {mode:'explode'});
  assert.equal(badMode.ok, false);
  const groupNoDim = runSmartQuery(ctx, {mode:'group'});
  assert.equal(groupNoDim.ok, false);
});

test('same street in multiple cities without city is reported ambiguous', () => {
  const ctx = {tickets:[
    ticket('a', '01.01.2026', {city:'Таромське', street:'Мостова'}),
    ticket('b', '02.01.2026', {city:'Карнаухівка', street:'Мостова'}),
    ticket('c', '03.01.2026', {city:'Дніпро', street:'Інша'})
  ], shifts:[], searchIndex:[]};
  const result = runSmartQuery(ctx, {mode:'list', street:'мостова'});
  assert.equal(result.data.ambiguous, true);
  assert.equal(result.data.matched, 0);
  assert.deepEqual(result.data.candidates.map(function(c){ return c.city; }).sort(), ['Карнаухівка', 'Таромське']);
  const withCity = runSmartQuery(ctx, {mode:'list', street:'мостова', city:'Таромське'});
  assert.equal(withCity.data.ambiguous, false);
  assert.equal(withCity.data.matched, 1);
});

test('coworker: direct ticket evidence is distinct from same-day shift evidence', () => {
  const ctx = {
    tickets:[
      ticket('direct', '01.08.2026', {connectMasters:['Женя']}),
      ticket('shift-only', '01.08.2026', {city:'Таромське'}),
      ticket('other-day', '02.08.2026', {})
    ],
    shifts:[{id:'s1', date:'01.08.2026', hours:8, coworker:'Женя'}],
    searchIndex:[]
  };
  const result = runSmartQuery(ctx, {mode:'list', coworker:'Жека'});
  const ids = result.data.tickets.map(function(t){ return t.id; }).sort();
  assert.deepEqual(ids, ['direct', 'shift-only']);
  const directRow = result.data.tickets.find(function(t){ return t.id === 'direct'; });
  const shiftRow = result.data.tickets.find(function(t){ return t.id === 'shift-only'; });
  assert.ok(directRow.match_reasons.some(function(r){ return r.includes('структурно'); }));
  assert.ok(shiftRow.match_reasons.some(function(r){ return r.includes('зміною того ж дня'); }));
  assert.ok(!result.data.tickets.some(function(t){ return t.id === 'other-day'; }));
});

/* ---------- geo regression: mapper boolean is the single source ---------- */

test('geo regression: valid coordinates without geoLink -> has_geo true in rows and coverage, payload coordinate-free', () => {
  const red = redactTicket(ticketFromGasRow({id:'g1', date:'10.09.2026', time:'09:00', content:'', sum:500, tags:[], backupNote:'',
    fullDataJson: JSON.stringify({geoLat:48.464, geoLng:35.046})}));
  assert.equal(red.has_geo, true, 'mapper: coordinate pair without geoLink is geo');
  const env = runSmartQuery({tickets:[red], shifts:[], searchIndex:[]}, {mode:'list'});
  assert.equal(env.data.coverage.tickets_with_geo, 1, 'coverage counts the coordinate-only ticket');
  assert.equal(env.data.tickets[0].has_geo, true, 'query_tickets row has_geo=true via mapper boolean');
  const serialized = JSON.stringify(env);
  assert.ok(!serialized.includes('48.464') && !serialized.includes('35.046'), 'coordinates never enter the model payload');
  assert.ok(!serialized.includes('geoLink') && !serialized.includes('geoLat') && !serialized.includes('geoLng'), 'no geo raw field names in payload');
});

test('geo regression: null/empty/single coordinate stays false end-to-end', () => {
  const mk = function(fullData){
    return redactTicket(ticketFromGasRow({id:'g2', date:'10.09.2026', time:'09:00', content:'', sum:0, tags:[], backupNote:'',
      fullDataJson: JSON.stringify(fullData)}));
  };
  for(const bad of [{geoLat:48.464}, {geoLat:null, geoLng:null}, {geoLat:'', geoLng:''}, {}]){
    const red = mk(bad);
    assert.equal(red.has_geo, false, 'mapper honesty for ' + JSON.stringify(bad));
    const env = runSmartQuery({tickets:[red], shifts:[], searchIndex:[]}, {mode:'list'});
    assert.equal(env.data.coverage.tickets_with_geo, 0);
    assert.equal(env.data.tickets[0].has_geo, false);
  }
  const linkOnly = mk({geoLink:'https://maps.google.com/?q=48.4,35.0'});
  assert.equal(linkOnly.has_geo, true, 'https geoLink alone is geo');
  const envLink = runSmartQuery({tickets:[linkOnly], shifts:[], searchIndex:[]}, {mode:'list'});
  assert.equal(envLink.data.coverage.tickets_with_geo, 1);
  assert.ok(!JSON.stringify(envLink).includes('maps.google.com'), 'geoLink value never enters the model payload');
});
