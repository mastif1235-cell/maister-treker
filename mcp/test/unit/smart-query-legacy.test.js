/* v91.45 regression: legacy/restored address resolution in smart-query.
   Real case: «Скільки заявок у мене в Миколаївці 1?» — AI saw only structured
   rows, while the app's ordinary search also matched legacy rows whose city/
   street/house live only in the textual address. One deterministic resolver
   (effectiveAddressParts) now fills ONLY missing structured parts, before
   pagination, for filters, group_by and aggregates. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {runSmartQuery} from '../../src/ask/smart-query.js';
import {parseLegacyAddress, legacyAddressFromText, effectiveAddressParts} from '../../src/ask/address.js';

function ticket(id, date, extra){
  return Object.assign({
    id, date, time:'11:00', type:'Монтаж', city:'', street:'', house:'', apartment:'',
    address:'', phone:'', extraPhones:[], macAddress:'', signal:'', payment:'Готівка', sum:800,
    tags:[], contractNumber:'', geoLink:'', equipment:[], cables:[], presetWorks:[],
    additionalWork:[], connectMasters:[]
  }, extra || {});
}

/* ---------- Миколаївка 1: mixed structured + legacy fixture ----------
   3 structured rows + 5 legacy rows (address text only / content lines only)
   = 8 tickets. No counts or street names are hardcoded anywhere in the fix. */
const STRUCTURED = [
  ticket('s1', '03.09.2026', {city:'Миколаївка 1', street:'Вул Садова', house:'19'}),
  ticket('s2', '05.09.2026', {city:'Миколаївка 1', street:'Вул Садова', house:'3'}),
  ticket('s3', '08.09.2026', {city:'Миколаївка 1', street:'Вул Центральна', house:'4'})
];
const LEGACY = [
  ticket('l1', '01.09.2026', {address:'Миколаївка 1, Вул Генерала Пушкіна 1'}),
  ticket('l2', '02.09.2026', {address:'Миколаївка 1, Педагогічна 5'}),
  ticket('l3', '04.09.2026', {address:'Миколаївка 1, Вул Виноградна 8'}),
  ticket('l4', '06.09.2026', {address:'Миколаївка 1, Вул Криворізька 3'}),
  ticket('l5', '07.09.2026', {}) /* address only inside legacy content text */
];
const SEARCH_INDEX = [{id:'l5', text:'🏙️ Місто: Миколаївка 1 📍 Адреса: Пʼятихатки 1 🔒 СЕКРЕТНА-НОТАТКА-777 клієнт просив не дзвонити'}];
const ALL = STRUCTURED.concat(LEGACY);
function ctx(){ return {tickets: ALL, shifts:[], searchIndex: SEARCH_INDEX}; }

/* ---------- resolver unit behaviour ---------- */

test('parseLegacyAddress splits city/street/house generically', () => {
  assert.deepEqual(parseLegacyAddress('Миколаївка 1, Вул Садова 19'), {city:'Миколаївка 1', street:'Вул Садова', house:'19'});
  assert.deepEqual(parseLegacyAddress('Педагогічна 1'), {city:'', street:'Педагогічна', house:'1'});
  assert.deepEqual(parseLegacyAddress('Дніпро, просп. Шевченка 12а'), {city:'Дніпро', street:'просп. Шевченка', house:'12а'});
  assert.equal(parseLegacyAddress(''), null);
});

test('legacyAddressFromText extracts Місто/Адреса lines from legacy content', () => {
  assert.equal(legacyAddressFromText(SEARCH_INDEX[0].text), 'Миколаївка 1, Пʼятихатки 1');
});

test('effectiveAddressParts: structured fields ALWAYS win, legacy fills only gaps', () => {
  const t = ticket('x', '01.01.2026', {city:'Дніпро', street:'Вул Садова', house:'7', address:'Миколаївка 1, Вул Садова 99'});
  const p = effectiveAddressParts(t, '🏙️ Місто: Таромське 📍 Адреса: вул. Інша 2');
  assert.equal(p.city, 'Дніпро');
  assert.equal(p.street, 'Вул Садова');
  assert.equal(p.house, '7');
  assert.deepEqual(p.via, {city:'structured', street:'structured', house:'structured'});
  const legacy = effectiveAddressParts(LEGACY[0], '');
  assert.deepEqual(legacy.via, {city:'legacy', street:'legacy', house:'legacy'});
  assert.equal(legacy.city, 'Миколаївка 1');
});

/* ---------- A: structured wins over legacy ---------- */

test('A: structured city wins over a conflicting legacy address string', () => {
  const t = ticket('x', '01.01.2026', {city:'Дніпро', street:'Вул Садова', house:'7', address:'Миколаївка 1, Вул Садова 99'});
  const inDnipro = runSmartQuery({tickets:[t], shifts:[], searchIndex:[]}, {mode:'count', city:'Дніпро'});
  assert.equal(inDnipro.data.total_matched, 1);
  const inMykola = runSmartQuery({tickets:[t], shifts:[], searchIndex:[]}, {mode:'count', city:'Миколаївка 1'});
  assert.equal(inMykola.data.total_matched, 0, 'legacy text must never overwrite a good structured city');
});

/* ---------- B: legacy city/street/house extracted when structured absent ---------- */

test('B: legacy ticket is found by city+street+house filters', () => {
  const r = runSmartQuery(ctx(), {mode:'list', city:'Миколаївка 1', street:'Педагогічна', house:'5'});
  assert.equal(r.data.total_matched, 1);
  assert.equal(r.data.tickets[0].id, 'l2');
  const reasons = r.data.tickets[0].match_reasons.join(' ');
  assert.match(reasons, /legacy адреса/);
});

/* ---------- C: city-only count includes structured + legacy ---------- */

test('C: «Скільки заявок у Миколаївці 1» counts structured AND legacy rows', () => {
  const r = runSmartQuery(ctx(), {mode:'count', city:'Миколаївка 1'});
  assert.equal(r.data.total_matched, 8, 'no more 5-vs-9 divergence: full matched set, legacy included');
  assert.equal(r.data.coverage.matched, 8);
});

/* ---------- D: group_by street includes legacy streets ---------- */

test('D: group_by street contains legacy streets deterministically', () => {
  const r = runSmartQuery(ctx(), {mode:'group', group_by:'street', city:'Миколаївка 1'});
  const keys = r.data.groups.map(function(g){ return g.key; });
  assert.ok(keys.includes('Вул Садова'), 'structured street');
  assert.ok(keys.includes('Педагогічна'), 'legacy street');
  assert.ok(keys.includes('Вул Криворізька'), 'legacy street');
  assert.ok(keys.includes('Пʼятихатки'), 'street parsed from legacy content lines');
  const sadova = r.data.groups.find(function(g){ return g.key === 'Вул Садова'; });
  assert.equal(sadova.count, 2, 'both structured Садова houses in one group');
  assert.ok(!keys.includes('(без структурованої вулиці)'), 'no legacy row dumped into the empty bucket');
});

/* ---------- E: house/address lookup on a legacy record ---------- */

test('E: house-level lookup works on legacy rows', () => {
  const r = runSmartQuery(ctx(), {mode:'list', city:'Миколаївка 1', house:'3'});
  const ids = r.data.tickets.map(function(t){ return t.id; }).sort();
  assert.deepEqual(ids, ['l4', 's2'], 'legacy Криворізька 3 + structured Садова 3');
});

/* ---------- F: Taromske strict signal < -25 keeps 6 including legacy ---------- */

test('F: strict signal_worse_than=-25 stays 6 on the mixed fixture (2 legacy rows included)', () => {
  const rows = [
    ticket('t1', '10.09.2026', {city:'Таромське', signal:'-26'}),
    ticket('t2', '10.09.2026', {city:'Таромське', signal:'-27'}),
    ticket('t3', '11.09.2026', {city:'Таромське', signal:'-30'}),
    ticket('t4', '11.09.2026', {city:'Таромське', signal:'-30.5'}),
    ticket('t5', '12.09.2026', {signal:'-28', address:'Таромське, вул. Мостова 25'}),
    ticket('t6', '12.09.2026', {signal:'-31', address:'Таромське, вул. Польова 2'}),
    ticket('t7', '12.09.2026', {city:'Таромське', signal:'-25'}) /* boundary: excluded */
  ];
  const r = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'list', city:'Таромське', signal_worse_than:-25});
  assert.equal(r.data.total_matched, 6, '4 structured + 2 legacy; -25 excluded (strict <)');
  const ids = r.data.tickets.map(function(t){ return t.id; }).sort();
  assert.deepEqual(ids, ['t1', 't2', 't3', 't4', 't5', 't6'], '4 structured + 2 legacy');
});

/* ---------- G: count and list operate on the SAME matched set ---------- */

test('G: mode=count and mode=list return the same total for identical params', () => {
  const count = runSmartQuery(ctx(), {mode:'count', city:'Миколаївка 1'});
  const list = runSmartQuery(ctx(), {mode:'list', city:'Миколаївка 1', limit:100});
  assert.equal(count.data.total_matched, list.data.total_matched);
  assert.equal(list.data.returned, 8);
});

/* ---------- H: pagination never changes the authoritative total/groups ---------- */

test('H: limit does not affect total_matched, grouping or analytics', () => {
  const paged = runSmartQuery(ctx(), {mode:'list', city:'Миколаївка 1', limit:2});
  assert.equal(paged.data.returned, 2);
  assert.equal(paged.data.total_matched, 8);
  const groupsPaged = runSmartQuery(ctx(), {mode:'group', group_by:'street', city:'Миколаївка 1'});
  const sumOfGroups = groupsPaged.data.groups.reduce(function(s, g){ return s + g.count; }, 0);
  assert.equal(sumOfGroups, 8, 'groups cover the full matched set, not the page');
  const listAll = runSmartQuery(ctx(), {mode:'list', city:'Миколаївка 1', limit:100});
  assert.deepEqual(
    listAll.data.analytics.unique_cities.map(function(c){ return c.name; }),
    ['Миколаївка 1'],
    'analytics sees legacy city too'
  );
});

/* ---------- I: private legacy note/content never leaves the Worker ---------- */

test('I: legacy private text used only for local parsing, absent from the model-facing envelope', () => {
  const r = runSmartQuery(ctx(), {mode:'list', city:'Миколаївка 1', limit:100});
  const payload = JSON.stringify(r.data);
  assert.ok(!payload.includes('СЕКРЕТНА-НОТАТКА-777'), 'raw legacy note text must not be serialized');
  assert.ok(!payload.includes('не дзвонити'), 'no raw private fragments');
  assert.ok(payload.includes('Пʼятихатки'), 'the parsed address part itself may appear (it is the address)');
});

/* ---------- v91.45: parser against REAL legacy record formats ----------
   Formats observed in old app records: explicit «Місто:/Адреса:» lines,
   comma variants, prefixed streets, lettered/fractional house numbers. */

test('legacy content with explicit «Місто:» and «Адреса:» lines', () => {
  assert.equal(legacyAddressFromText('🏙️ Місто: Миколаївка 1 📍 Адреса: Вул Садова 19'), 'Миколаївка 1, Вул Садова 19');
  assert.equal(legacyAddressFromText('Місто: Таромське Адреса: вул. Мостова 25'), 'Таромське, вул. Мостова 25');
  assert.equal(legacyAddressFromText('📍 Адреса: Педагогічна 1'), 'Педагогічна 1');
  assert.equal(legacyAddressFromText('🏙️ Місто: Дніпро'), 'Дніпро');
});

test('parseLegacyAddress handles the comma/spelling variants of old records', () => {
  /* city, street house */
  assert.deepEqual(parseLegacyAddress('Миколаївка 1, Вул Садова 19'), {city:'Миколаївка 1', street:'Вул Садова', house:'19'});
  /* city, street, house (house separated by comma) */
  assert.deepEqual(parseLegacyAddress('Миколаївка 1, Вул Садова, 19'), {city:'Миколаївка 1', street:'Вул Садова', house:'19'});
  /* street, house — no city part */
  assert.deepEqual(parseLegacyAddress('Вул Криворізька, 3'), {city:'', street:'Вул Криворізька', house:'3'});
  /* street house — no comma at all */
  assert.deepEqual(parseLegacyAddress('Педагогічна 1'), {city:'', street:'Педагогічна', house:'1'});
  /* Russian «ул.» prefix is not mistaken for a city */
  assert.deepEqual(parseLegacyAddress('ул. Шевченка 12'), {city:'', street:'ул. Шевченка', house:'12'});
  /* lettered house number */
  assert.deepEqual(parseLegacyAddress('Дніпро, просп. Миру 12а'), {city:'Дніпро', street:'просп. Миру', house:'12а'});
  /* fractional house number */
  assert.deepEqual(parseLegacyAddress('Дніпро, ул. Польова 3/14'), {city:'Дніпро', street:'ул. Польова', house:'3/14'});
  /* digit glued to the street name stays one token — no guessing */
  assert.deepEqual(parseLegacyAddress('Миколаївка 1, Садова19'), {city:'Миколаївка 1', street:'Садова19', house:''});
});

test('effectiveAddressParts fills each missing part independently', () => {
  /* structured house present, city/street missing -> legacy fills only those two */
  const t = {city:'', street:'', house:'7', address:'Миколаївка 1, Вул Садова 99'};
  const p = effectiveAddressParts(t, '');
  assert.equal(p.city, 'Миколаївка 1');
  assert.equal(p.street, 'Вул Садова');
  assert.equal(p.house, '7', 'structured house wins over the parsed 99');
  assert.deepEqual(p.via, {city:'legacy', street:'legacy', house:'structured'});
});

/* ---------- v91.45 r3: effective address in ambiguity + group identity ---------- */

test('street ambiguity sees legacy/effective cities, not only raw t.city', () => {
  const rows = [
    ticket('a1', '01.09.2026', {city:'Дніпро', street:'Вул Садова', house:'1'}),
    ticket('b1', '02.09.2026', {address:'Таромське, Вул Садова 2'}) /* legacy row */
  ];
  const r = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'list', street:'Вул Садова'});
  assert.equal(r.data.ambiguous, true, 'the same street exists in two REAL cities');
  assert.deepEqual(
    r.data.candidates.map(function(c){ return c.city; }).sort(),
    ['Дніпро', 'Таромське'],
    'both cities come from the SAME effective address the filter used'
  );
});

test('street ambiguity stays false when the street is in one city only', () => {
  const rows = [
    ticket('a1', '01.09.2026', {city:'Дніпро', street:'Вул Садова', house:'1'}),
    ticket('a2', '02.09.2026', {address:'Дніпро, Вул Садова 2'})
  ];
  const r = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'list', street:'Вул Садова'});
  assert.equal(r.data.ambiguous, false);
  assert.equal(r.data.total_matched, 2);
});

test('group_by city merges structured and legacy rows of one real city into ONE group', () => {
  const rows = [
    ticket('s1', '01.09.2026', {city:'Таромське', street:'вул. Мостова', house:'1'}),
    ticket('l1', '02.09.2026', {address:'Таромське, вул. Польова 2'})
  ];
  const r = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'group', group_by:'city'});
  assert.equal(r.data.groups.length, 1, 'no «Таромське (legacy)» split — origin is evidence, not identity');
  const g = r.data.groups[0];
  assert.equal(g.key, 'Таромське');
  assert.equal(g.count, 2);
  assert.equal(g.sum, 1600);
  assert.equal(g.last_date, '02.09.2026');
});

/* ---------- v91.45 r4: canonical city identity ---------- */

import {canonicalCityKey} from '../../src/ask/address.js';

test('canonicalCityKey collapses UA/RU spellings and keeps the trailing-digit guard', () => {
  assert.equal(canonicalCityKey('Таромське'), canonicalCityKey('Таромское'));
  assert.equal(canonicalCityKey('Дніпро'), canonicalCityKey('Днепр'));
  assert.notEqual(canonicalCityKey('Миколаївка 1'), canonicalCityKey('Миколаївка 2'), 'digit guard: two distinct settlements');
  assert.notEqual(canonicalCityKey('Миколаївка 1'), canonicalCityKey('Миколаївка'));
  assert.equal(canonicalCityKey(''), '');
});

test('A: one street in Таромське vs Таромское is NOT ambiguous — one real settlement', () => {
  const rows = [
    ticket('a1', '01.09.2026', {city:'Таромське', street:'Вул Садова', house:'1'}),
    ticket('b1', '02.09.2026', {address:'Таромское, Вул Садова 2'}) /* legacy, RU spelling */
  ];
  const r = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'list', street:'Вул Садова'});
  assert.equal(r.data.ambiguous, false, 'spelling variants of one city never produce ambiguity');
  assert.equal(r.data.total_matched, 2);
});

test('B: group_by city merges Таромське + Таромское into ONE group with a real human name', () => {
  const rows = [
    ticket('a1', '01.09.2026', {city:'Таромське', street:'Вул Садова', house:'1'}),
    ticket('b1', '02.09.2026', {address:'Таромское, Вул Садова 2'})
  ];
  const r = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'group', group_by:'city'});
  assert.equal(r.data.groups.length, 1, 'one real city = one group');
  assert.equal(r.data.groups[0].count, 2);
  assert.ok(/^(Таромське|Таромское)$/.test(r.data.groups[0].key), 'display stays a real variant, not a stem: ' + r.data.groups[0].key);
});

test('digit guard end-to-end: Миколаївка 1 and Миколаївка 2 stay two cities everywhere', () => {
  const rows = [
    ticket('m1', '01.09.2026', {city:'Миколаївка 1', street:'Вул Садова', house:'3'}),
    ticket('m2', '02.09.2026', {address:'Миколаївка 2, Вул Садова 7'})
  ];
  const groups = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'group', group_by:'city'});
  assert.equal(groups.data.groups.length, 2, 'never merge distinct settlements sharing a name stem');
  const amb = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'list', street:'Вул Садова'});
  assert.equal(amb.data.ambiguous, true);
  assert.deepEqual(amb.data.candidates.map(function(c){ return c.city; }).sort(), ['Миколаївка 1', 'Миколаївка 2']);
});

test('full-set unique_cities analytics collapses spellings of one city', () => {
  const rows = [
    ticket('a1', '01.09.2026', {city:'Таромське', street:'вул. А', house:'1'}),
    ticket('b1', '02.09.2026', {address:'Таромское, вул. Б 2'}),
    ticket('c1', '03.09.2026', {city:'Дніпро', street:'вул. В', house:'3'})
  ];
  const r = runSmartQuery({tickets:rows, shifts:[], searchIndex:[]}, {mode:'list', limit:100});
  const names = r.data.analytics.unique_cities.map(function(c){ return c.name; }).sort();
  assert.equal(names.length, 2, 'Таромське/Таромское counted once');
  assert.ok(names.includes('Дніпро'));
  const tar = r.data.analytics.unique_cities.find(function(c){ return /Таром/.test(c.name); });
  assert.equal(tar.count, 2);
});
