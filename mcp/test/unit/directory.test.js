/* Stage 2D unit: the AddressBook projection store (sanitize, UNION merge,
   KV envelope) and the UUID-first resolver over its index. */
import test from 'node:test';
import assert from 'node:assert/strict';

import {sanitizeDirectory, mergeDirectories, createDirectoryStore, directoryKey, DIRECTORY_VERSION, directoryId} from '../../src/data/directory.js';
import {
  buildDirectoryIndex, resolveDirectoryCity, resolveDirectoryStreet, resolveDirectoryPlace, attributeLegacyRow,
  knownTicketIds, directoryCities, directoryStreets, directoryNames
} from '../../src/ask/directory-index.js';
import {placeExactKey} from '../../src/ask/address.js';

const C_TAROM = '3c8f1d20-aaaa-4bbb-8ccc-000000000001';
const C_SHEV = '3c8f1d20-aaaa-4bbb-8ccc-000000000002';
const C_YASNY = '3c8f1d20-aaaa-4bbb-8ccc-000000000003';
const S_PRYV = '3c8f1d20-aaaa-4bbb-8ccc-000000000011';
const S_KOBZ_T = '3c8f1d20-aaaa-4bbb-8ccc-000000000012';
const S_SHEV = '3c8f1d20-aaaa-4bbb-8ccc-000000000013';
const S_KOBZ_S = '3c8f1d20-aaaa-4bbb-8ccc-000000000014';
const S_NOVO = '3c8f1d20-aaaa-4bbb-8ccc-000000000015';
const S_OLD = '3c8f1d20-aaaa-4bbb-8ccc-000000000016';

function directory(){
  return {v:1,
    cities:[
      {id:C_TAROM, name:'Таромське', aliases:['Таромское'], active:true, updatedAt:'2026-09-01T00:00:00.000Z'},
      {id:C_SHEV, name:'Шевченко', aliases:[], active:true, updatedAt:'2026-09-01T00:00:00.000Z'},
      {id:C_YASNY, name:'Ясний', aliases:[], active:true, updatedAt:'2026-09-01T00:00:00.000Z'}
    ],
    streets:[
      {id:S_PRYV, cityId:C_TAROM, name:'Вул Привокзальна', aliases:['Привокзальная'], active:true, updatedAt:'2026-09-01T00:00:00.000Z'},
      {id:S_KOBZ_T, cityId:C_TAROM, name:'Вул Кобзаря', aliases:[], active:true, updatedAt:'2026-09-01T00:00:00.000Z'},
      {id:S_SHEV, cityId:C_SHEV, name:'Вул Шевченко', aliases:[], active:true, updatedAt:'2026-09-01T00:00:00.000Z'},
      {id:S_KOBZ_S, cityId:C_SHEV, name:'Вул Кобзаря', aliases:[], active:true, updatedAt:'2026-09-01T00:00:00.000Z'},
      {id:S_NOVO, cityId:C_YASNY, name:'Вул Новопокровська', aliases:['Новопокровская'], active:true, updatedAt:'2026-09-01T00:00:00.000Z'},
      {id:S_OLD, cityId:C_YASNY, name:'Вул Стара', aliases:[], active:false, updatedAt:'2026-09-01T00:00:00.000Z'}
    ]};
}

function fakeKv(){
  const map = new Map();
  return {map, get: async key => (map.has(key) ? map.get(key) : null), put: async (key, value) => { map.set(key, value); }};
}

test('placeExactKey: same spelling only — service words dropped, no stemming, no UA/RU bridging', () => {
  assert.equal(placeExactKey('Вул. Привокзальна'), 'привокзальна');
  assert.equal(placeExactKey('ул Привокзальная'), 'привокзальная');
  assert.notEqual(placeExactKey('Привокзальна'), placeExactKey('Привокзальная'));
  assert.equal(placeExactKey('в Таромському'), 'таромському');
  assert.equal(placeExactKey('  Миколаївка   1 '), 'миколаївка 1');
  assert.equal(placeExactKey(''), '');
});

test('sanitizeDirectory: shape, limits, junk entries dropped, aliases deduplicated, ids canonical', () => {
  assert.equal(sanitizeDirectory(null).ok, false);
  assert.equal(sanitizeDirectory({v:2, cities:[], streets:[]}).code, 'UNSUPPORTED_VERSION');
  assert.equal(sanitizeDirectory({v:1, cities:'x', streets:[]}).code, 'INVALID_DIRECTORY');
  assert.equal(sanitizeDirectory({v:1, cities:[], streets:[], __proto__:{polluted:true}}).ok, true, 'own enumerable keys only');
  assert.equal(sanitizeDirectory(JSON.parse('{"v":1,"cities":[{"__proto__":{"x":1},"id":"3c8f1d20-aaaa-4bbb-8ccc-000000000001","name":"A"}],"streets":[]}')).code, 'INVALID_DIRECTORY');
  const raw = directory();
  raw.cities.push({id:'not-a-uuid', name:'Junk'});
  raw.cities.push({id:C_TAROM.toUpperCase(), name:'Duplicate id'});
  raw.streets.push({id:'3c8f1d20-aaaa-4bbb-8ccc-0000000000ff', cityId:'nope', name:'Orphan without city id'});
  raw.streets.push({id:'3c8f1d20-aaaa-4bbb-8ccc-0000000000fe', cityId:C_TAROM, name:'   ', aliases:['x']});
  raw.streets[0].aliases = ['Привокзальная', 'Привокзальная', 'Вул Привокзальна', '', 42, ' Привокзальна '];
  const cleaned = sanitizeDirectory(raw);
  assert.equal(cleaned.ok, true);
  assert.equal(cleaned.dropped, 4);
  assert.equal(cleaned.data.cities.length, 3);
  assert.equal(cleaned.data.streets.length, 6);
  assert.deepEqual(cleaned.data.streets[0].aliases, ['Привокзальная', 'Привокзальна'], 'duplicates, the name itself and junk removed');
  assert.equal(cleaned.data.cities[0].active, true);
  assert.equal(sanitizeDirectory({v:1, cities:new Array(2001).fill({id:C_TAROM, name:'x'}), streets:[]}).code, 'DIRECTORY_TOO_LARGE');
  assert.equal(directoryId(C_TAROM.toUpperCase()), C_TAROM, 'ids compare lower-case');
});

test('mergeDirectories: UNION by UUID, newer updatedAt wins, nothing is ever deleted', () => {
  const a = sanitizeDirectory(directory()).data;
  const phoneB = sanitizeDirectory({v:1,
    cities:[{id:'3c8f1d20-bbbb-4bbb-8ccc-000000000001', name:'Таромське', aliases:[], active:true, updatedAt:'2026-09-02T00:00:00.000Z'},
      {id:C_TAROM, name:'Таромське (стара назва)', aliases:['Таромское'], active:true, updatedAt:'2026-08-01T00:00:00.000Z'}],
    streets:[{id:S_PRYV, cityId:C_TAROM, name:'Вулиця Привокзальна', aliases:['Вул Привокзальна', 'Привокзальная'], active:true, updatedAt:'2026-09-03T00:00:00.000Z'}]}).data;
  const merged = mergeDirectories(a, phoneB);
  assert.equal(merged.cities.length, 4, 'phone B duplicate city keeps its own UUID next to phone A (no fuzzy merge)');
  assert.equal(merged.cities.find(c => c.id === C_TAROM).name, 'Таромське', 'older incoming copy does not overwrite the newer one');
  assert.equal(merged.streets.find(s => s.id === S_PRYV).name, 'Вулиця Привокзальна', 'newer rename wins');
  assert.equal(merged.streets.length, 6, 'no street lost');
  assert.deepEqual(mergeDirectories(null, a), a);
  const tie = mergeDirectories(a, sanitizeDirectory({v:1, cities:[{id:C_SHEV, name:'Шевченко', aliases:['Shevchenko'], active:false, updatedAt:'2026-09-01T00:00:00.000Z'}], streets:[]}).data);
  assert.equal(tie.cities.find(c => c.id === C_SHEV).active, false, 'equal stamps: the incoming (latest push) wins');
});

test('createDirectoryStore: absent key → legacy state; put merges and invalidates the memo; broken KV never throws', async () => {
  const kv = fakeKv();
  let now = 1000;
  const store = createDirectoryStore({kv, now: () => now, memoMs:10000});
  assert.deepEqual(await store.get(), {available:false, reason:'not_pushed'});
  const first = await store.put(directory());
  assert.equal(first.ok, true);
  assert.equal(first.cities, 3); assert.equal(first.streets, 6); assert.equal(first.dropped, 0);
  const envelope = JSON.parse(kv.map.get(directoryKey()));
  assert.equal(envelope.v, DIRECTORY_VERSION); assert.equal(envelope.savedAt, 1000);
  assert.ok(!JSON.stringify(envelope).includes('ticket'), 'the directory key holds places only');
  const loaded = await store.get();
  assert.equal(loaded.available, true); assert.equal(loaded.data.streets.length, 6); assert.equal(loaded.savedAt, 1000);
  now = 2000;
  const second = await store.put({v:1, cities:[], streets:[{id:'3c8f1d20-aaaa-4bbb-8ccc-000000000099', cityId:C_SHEV, name:'Вул Нова', aliases:[], active:true, updatedAt:'2026-09-20T10:00:00.000Z'}]});
  assert.equal(second.streets, 7, 'a partial push is a UNION, not a replacement');
  assert.equal((await store.get()).data.streets.length, 7, 'memo invalidated by put');
  assert.equal((await store.put({v:1, cities:'x'})).code, 'INVALID_DIRECTORY');
  const noKv = createDirectoryStore({kv:null});
  assert.deepEqual(await noKv.get(), {available:false, reason:'no_kv'});
  assert.equal((await noKv.put(directory())).code, 'KV_UNAVAILABLE');
  const broken = createDirectoryStore({kv:{get: async () => { throw new Error('boom'); }, put: async () => { throw new Error('boom'); }}, log(){}});
  assert.equal((await broken.get()).available, false);
  assert.equal((await broken.put(directory())).code, 'KV_WRITE_FAILED');
  kv.map.set(directoryKey(), '{"v":1,"savedAt":"x"}');
  assert.equal((await createDirectoryStore({kv}).get()).available, false, 'a malformed envelope is ignored, not thrown');
});

test('resolver: exact name, explicit alias, Stage 1 identity, city-scoped streets, ambiguity never guessed', () => {
  const index = buildDirectoryIndex(sanitizeDirectory(directory()).data);
  assert.equal(index.counts.cities, 3); assert.equal(index.counts.streets, 6);
  /* Шевченко the city and Вул Шевченко the street never collide */
  assert.equal(resolveDirectoryCity(index, 'Шевченко').cityId, C_SHEV);
  assert.equal(resolveDirectoryStreet(index, null, 'Шевченко').streetId, S_SHEV);
  assert.notEqual(resolveDirectoryCity(index, 'Шевченко').cityId, resolveDirectoryStreet(index, null, 'Шевченко').streetId);
  /* alias → same UUID, current name reported */
  const alias = resolveDirectoryCity(index, 'Таромское');
  assert.equal(alias.status, 'ALIAS_EXACT'); assert.equal(alias.cityId, C_TAROM); assert.equal(alias.city.name, 'Таромське');
  assert.equal(resolveDirectoryStreet(index, C_TAROM, 'ул. Привокзальная').status, 'ALIAS_EXACT');
  /* the Stage 1 identity key (cases, UA/RU) is the second, still deterministic tier */
  assert.equal(resolveDirectoryCity(index, 'в Таромському').status, 'IDENTITY');
  assert.equal(resolveDirectoryCity(index, 'в Таромському').cityId, C_TAROM);
  assert.equal(resolveDirectoryStreet(index, C_YASNY, 'Новопокровской').status, 'IDENTITY');
  /* same street name in two cities: scoped by city, ambiguous without it */
  assert.equal(resolveDirectoryStreet(index, C_TAROM, 'Кобзаря').streetId, S_KOBZ_T);
  assert.equal(resolveDirectoryStreet(index, C_SHEV, 'Кобзаря').streetId, S_KOBZ_S);
  const ambiguous = resolveDirectoryStreet(index, null, 'Кобзаря');
  assert.equal(ambiguous.status, 'AMBIGUOUS');
  assert.deepEqual(ambiguous.candidates.map(c => c.city).sort(), ['Таромське', 'Шевченко']);
  assert.equal(resolveDirectoryStreet(index, null, 'Привокзальная').streetId, S_PRYV, 'unique across cities → resolved with its city');
  assert.equal(resolveDirectoryStreet(index, null, 'Привокзальная').cityId, C_TAROM);
  assert.equal(resolveDirectoryStreet(index, C_SHEV, 'Привокзальная').status, 'NO_MATCH', 'scoped lookup never leaks across cities');
  assert.equal(resolveDirectoryCity(index, 'Невідоме').status, 'NO_MATCH');
  assert.equal(resolveDirectoryCity(index, '').status, 'MALFORMED');
  assert.equal(resolveDirectoryCity(null, 'Шевченко').status, 'NO_DIRECTORY');
  /* archived: resolvable when unique (history stays findable), hidden from the default list */
  assert.equal(resolveDirectoryStreet(index, C_YASNY, 'Стара').streetId, S_OLD);
  assert.deepEqual(directoryStreets(index, C_YASNY, false).map(s => s.name), ['Вул Новопокровська']);
  assert.deepEqual(directoryStreets(index, C_YASNY, true).map(s => s.name), ['Вул Новопокровська', 'Вул Стара']);
  assert.deepEqual(directoryCities(index, false).map(c => [c.name, c.street_count, c.archived_street_count]), [['Таромське', 2, 0], ['Шевченко', 2, 0], ['Ясний', 1, 1]]);
  /* combined resolution */
  const place = resolveDirectoryPlace(index, 'Таромское', 'Кобзаря');
  assert.deepEqual([place.cityId, place.streetId, place.cityStatus, place.streetStatus], [C_TAROM, S_KOBZ_T, 'ALIAS_EXACT', 'EXACT']);
  const streetOnly = resolveDirectoryPlace(index, '', 'Новопокровская');
  assert.deepEqual([streetOnly.cityId, streetOnly.streetId, streetOnly.cityStatus], [C_YASNY, S_NOVO, 'FROM_STREET']);
  const wrongCity = resolveDirectoryPlace(index, 'Шевченко', 'Привокзальная');
  assert.deepEqual([wrongCity.cityId, wrongCity.streetId, wrongCity.streetStatus], [C_SHEV, null, 'NO_MATCH']);
  assert.deepEqual(directoryNames(index, 'street', S_PRYV), ['Вул Привокзальна', 'Привокзальная']);
});

test('active beats archived on a shared spelling; two active twins stay ambiguous', () => {
  const raw = directory();
  raw.cities.push({id:'3c8f1d20-aaaa-4bbb-8ccc-0000000000a1', name:'Шевченко', aliases:[], active:false, updatedAt:''});
  let index = buildDirectoryIndex(sanitizeDirectory(raw).data);
  assert.equal(resolveDirectoryCity(index, 'Шевченко').cityId, C_SHEV, 'the archived twin does not block the active city');
  raw.cities.push({id:'3c8f1d20-aaaa-4bbb-8ccc-0000000000a2', name:'Шевченко', aliases:[], active:true, updatedAt:''});
  index = buildDirectoryIndex(sanitizeDirectory(raw).data);
  const twins = resolveDirectoryCity(index, 'Шевченко');
  assert.equal(twins.status, 'AMBIGUOUS');
  assert.equal(twins.candidates.length, 2, 'only the active twins are offered');
});

test('rename keeps the UUID: old spelling resolves through the alias, new spelling through the name', () => {
  const raw = directory();
  raw.streets[0] = Object.assign({}, raw.streets[0], {name:'Вулиця Залізнична', aliases:['Вул Привокзальна', 'Привокзальная']});
  const index = buildDirectoryIndex(sanitizeDirectory(raw).data);
  assert.equal(resolveDirectoryStreet(index, C_TAROM, 'Залізнична').streetId, S_PRYV);
  assert.equal(resolveDirectoryStreet(index, C_TAROM, 'Привокзальна').streetId, S_PRYV);
  assert.equal(resolveDirectoryStreet(index, C_TAROM, 'Привокзальна').street.name, 'Вулиця Залізнична', 'the current name is what the user sees');
});

test('ticket ids: only ids THIS directory knows count; legacy rows are attributed only on a unique match', () => {
  const index = buildDirectoryIndex(sanitizeDirectory(directory()).data);
  assert.deepEqual(knownTicketIds(index, {cityId:C_TAROM, streetId:S_PRYV}), {cityId:C_TAROM, streetId:S_PRYV});
  assert.deepEqual(knownTicketIds(index, {cityId:'3c8f1d20-ffff-4bbb-8ccc-000000000001', streetId:S_PRYV}), {cityId:null, streetId:S_PRYV}, 'foreign city id is ignored');
  assert.deepEqual(knownTicketIds(index, {cityId:'junk', streetId:''}), {cityId:null, streetId:null});
  assert.deepEqual(attributeLegacyRow(index, 'Таромское', 'Привокзальная'), {cityId:C_TAROM, streetId:S_PRYV});
  assert.equal(attributeLegacyRow(index, '', 'Кобзаря'), null, 'two candidate streets, no city → no attribution');
  assert.deepEqual(attributeLegacyRow(index, 'Шевченко', 'Кобзаря'), {cityId:C_SHEV, streetId:S_KOBZ_S});
  assert.equal(attributeLegacyRow(index, 'Невідоме місто', 'Привокзальная'), null, 'a row naming an unknown city is not re-homed by its street');
  assert.equal(attributeLegacyRow(index, 'Таромське', ''), null);
});
