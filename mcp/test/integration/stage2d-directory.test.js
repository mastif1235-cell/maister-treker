/* Stage 2D — AddressBook → Worker/KV → AI, through the full Worker.

   The phone side is the REAL app code (js/address-book.js builds the
   directory with permanent UUIDs, js/address-book-sync.js builds the exact
   projection the PWA POSTs), the Worker side is the real createApp with a fake
   KV, GAS rows shaped like Code.gs output. Pinned scenario (from the task):
     1) a city with cityId and street A (streetId A) exist; 2) the snapshot is
     pushed; 3) the user creates a ticket on a NEW street B → the AddressBook
     creates Street B with a new UUID; 4) the next push carries B; 5) «Какие
     улицы есть в <городе>?» (DIRECTORY) now sees A and B; 6) «На каких улицах
     есть заявки?» (TICKETS) is independent of the directory;
   plus rename+alias, archive, legacy ticket, an old snapshot without any
   directory, UUID-first follow-ups and the production control phrases. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

import {createApp} from '../../src/index.js';
import {directoryKey} from '../../src/data/directory.js';
import {snapshotKey} from '../../src/data/snapshot.js';
import {ASK_SYSTEM_PROMPT, createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {mockGasFetch, toolCall, toolData, BEARER_TOKEN} from '../helpers/mcpapp.js';

const require = createRequire(import.meta.url);
const AB = require('../../../js/address-book.js');
const Sync = require('../../../js/address-book-sync.js');

/* ---------- one isolated fixture per test: the real AddressBook + Sheets rows ---------- */
function fixture(){
  const book = AB.fromLegacy({cities:['Шевченко', 'Таромське', 'Ясний'], streets:{
    'Шевченко':['Вул Шевченко'],
    'Таромське':['Вул Привокзальна', 'Вул Кобзаря'],
    'Ясний':['Вул Новопокровська']
  }});
  const city = name => book.cities.find(c => c.name === name);
  const street = (cityName, name) => book.streets.find(s => s.cityId === city(cityName).id && s.name === name);
  const SHEV = city('Шевченко'), TAROM = city('Таромське'), YASNY = city('Ясний');
  const STREET_A = street('Шевченко', 'Вул Шевченко');
  const PRYV = street('Таромське', 'Вул Привокзальна');
  const KOBZ = street('Таромське', 'Вул Кобзаря');
  const NOVO = street('Ясний', 'Вул Новопокровська');
  AB.update(book, 'cities', TAROM.id, {aliases:['Таромское']});
  AB.update(book, 'streets', PRYV.id, {aliases:['Привокзальная']});
  AB.update(book, 'streets', NOVO.id, {aliases:['Новопокровская']});
  /* Sheets rows (Code.gs shape): linked rows keep the RU spelling the master
     typed and carry the identity in the ids; one LEGACY row without ids. */
  const rows = [
    gasRow('t-pryv-3b-1', {type:'Ремонт', city:'Таромское', street:'Вул Привокзальна', house:'3б', apartment:'1', address:'Вул Привокзальна 3б, кв. 1', cityId:TAROM.id, streetId:PRYV.id}),
    gasRow('t-pryv-3b-2', {type:'Ремонт', city:'Таромское', street:'Вул Привокзальна', house:'3б', apartment:'2', address:'Вул Привокзальна 3б, кв. 2', cityId:TAROM.id, streetId:PRYV.id}),
    gasRow('t-k10', {type:'Ремонт', city:'Таромське', street:'Вул Кобзаря', house:'10', address:'Вул Кобзаря 10', cityId:TAROM.id, streetId:KOBZ.id}),
    gasRow('t-k15', {type:'Підключення', city:'Таромське', street:'Вул Кобзаря', house:'15', address:'Вул Кобзаря 15', cityId:TAROM.id, streetId:KOBZ.id}),
    gasRow('t-n37', {type:'Підключення', city:'Ясний', street:'Вул Новопокровська', house:'37', address:'Вул Новопокровська 37', cityId:YASNY.id, streetId:NOVO.id}),
    gasRow('t-shev-1', {type:'Ремонт', city:'Шевченко', street:'Вул Шевченко', house:'1', address:'Вул Шевченко 1', cityId:SHEV.id, streetId:STREET_A.id}),
    gasRow('t-shev-legacy', {type:'Ремонт', city:'Шевченко', street:'Вул Шевченко', house:'2', address:'Вул Шевченко 2'}, {date:'01.05.2025'})
  ];
  const listPayload = () => ({status:'ok', tickets:rows.slice(), shifts:[], states:{ticket:[], shift:[]}});
  const kv = fakeKv();
  async function appWith(env){
    const app = createApp(env || envFor(kv), {fetchImpl: mockGasFetch('ok', listPayload())});
    await app.appPromise;
    return app;
  }
  /* what the phone sends — the real projection of the real book */
  const push = app => app.fetch(pushRequest(Sync.projection(book)));
  return {book, city, street, SHEV, TAROM, YASNY, STREET_A, PRYV, KOBZ, NOVO, rows, kv, appWith, push};
}

function gasRow(id, full, extra){
  return Object.assign({id, date:'03.06.2026', time:'17:54', content:'', sum:0, tags:[], backupNote:'', photo:null,
    fullDataJson: JSON.stringify(full)}, extra || {});
}
function fakeKv(){
  const map = new Map();
  return {map, get: async key => (map.has(key) ? map.get(key) : null), put: async (key, value) => { map.set(key, value); }};
}
function envFor(kv){
  return {GAS_SYNC_URL:'https://script.google.com/macros/s/TESTDEPLOY/exec', GAS_SYNC_HMAC_SECRET:'0123456789abcdef0123456789abcdef',
    MCP_BEARER_TOKENS:'test-cli:' + BEARER_TOKEN + ':read', MT_SNAPSHOT_KV:kv};
}
function pushRequest(body, headers){
  return new Request('https://mcp.example.test/directory', {method:'POST',
    headers:Object.assign({'Content-Type':'application/json', Authorization:'Bearer ' + BEARER_TOKEN}, headers || {}),
    body: typeof body === 'string' ? body : JSON.stringify(body)});
}
const call = async (app, name, args) => toolData((await toolCall(app, name, args)).result);

test('POST /directory: fail-closed transport (method, auth, size, shape), CORS preflight, counts-only response', async () => {
  const f = fixture();
  const {kv} = f;
  const app = await f.appWith();
  const phonePush = f.push;
  const preflight = await app.fetch(new Request('https://mcp.example.test/directory', {method:'OPTIONS'}));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await app.fetch(new Request('https://mcp.example.test/directory', {method:'GET'}))).status, 405);
  const noAuth = await app.fetch(new Request('https://mcp.example.test/directory', {method:'POST', body:'{}'}));
  assert.equal(noAuth.status, 401);
  assert.equal(kv.map.has(directoryKey()), false, 'nothing stored without auth');
  assert.equal((await app.fetch(pushRequest('{not json'))).status, 400);
  const badShape = await app.fetch(pushRequest({v:1, cities:'x', streets:[]}));
  assert.equal(badShape.status, 400);
  assert.equal((await badShape.json()).code, 'INVALID_DIRECTORY');
  assert.equal((await app.fetch(pushRequest({v:7, cities:[], streets:[]}))).status, 400);
  const huge = await app.fetch(pushRequest('{"v":1,"cities":[],"streets":[],"pad":"' + 'x'.repeat(1048576) + '"}'));
  assert.equal(huge.status, 413);
  const ok = await phonePush(app);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), '*');
  const body = await ok.json();
  assert.deepEqual(Object.keys(body).sort(), ['cities', 'dropped', 'ok', 'saved_at', 'streets']);
  assert.equal(body.cities, 3); assert.equal(body.streets, 4); assert.equal(body.dropped, 0);
  assert.ok(!JSON.stringify(body).includes('Шевченко'), 'response carries counts only');
  const stored = JSON.parse(kv.map.get(directoryKey()));
  assert.equal(stored.v, 1);
  assert.deepEqual(stored.data.cities.map(c => c.name).sort(), ['Таромське', 'Шевченко', 'Ясний']);
  assert.ok(!JSON.stringify(stored).match(/ticket|clientName|phone|fullDataJson/), 'the directory key holds places only');
  assert.equal(kv.map.has(snapshotKey()), false, 'pushing the directory never touches the ticket snapshot key');
});

test('no KV binding: /directory answers 503 and every tool keeps the ticket-derived behaviour', async () => {
  const f = fixture();
  const app = await f.appWith({GAS_SYNC_URL:'https://script.google.com/macros/s/TESTDEPLOY/exec', GAS_SYNC_HMAC_SECRET:'0123456789abcdef0123456789abcdef',
    MCP_BEARER_TOKENS:'test-cli:' + BEARER_TOKEN + ':read'});
  const pushed = await f.push(app);
  assert.equal(pushed.status, 503);
  assert.equal((await pushed.json()).code, 'KV_UNAVAILABLE');
  const directory = await call(app, 'list_directory', {city:'Шевченко'});
  assert.equal(directory.available, false); assert.equal(directory.fallback, 'list_places');
  const places = await call(app, 'list_places', {city:'Шевченко'});
  assert.equal(places.source, 'tickets'); assert.equal(places.directory_available, false);
  assert.deepEqual(places.places[0].streets.map(s => s.street), ['Вул Шевченко']);
  const q = await call(app, 'query_tickets', {mode:'count', city:'Шевченко'});
  assert.equal(q.matched, 2); assert.equal('directory' in q, false, 'no directory → no directory block, same envelope as before');
});

test('scenario: street A pushed → ticket on NEW street B → next push → DIRECTORY sees A and B, TICKETS stays independent', async () => {
  const f = fixture();
  const {book, street, SHEV, TAROM, STREET_A, KOBZ} = f;
  const app = await f.appWith();
  const phonePush = f.push;
  /* 1-2) directory with city + street A pushed */
  assert.equal((await phonePush(app)).status, 200);
  let dir = await call(app, 'list_directory', {city:'Шевченко'});
  assert.equal(dir.available, true); assert.equal(dir.source, 'directory');
  assert.equal(dir.city.city_id, SHEV.id); assert.equal(dir.city.name, 'Шевченко');
  assert.deepEqual(dir.streets.map(s => [s.street_id, s.name]), [[STREET_A.id, 'Вул Шевченко']]);
  assert.equal(dir.street_count, 1);
  assert.ok(dir.directory_as_of, 'freshness of the directory copy is reported');
  /* 3) the master saves a ticket on a street that is not in the book yet —
        exactly what the calculator does (mtAddressBookRemember) */
  assert.equal(AB.remember(book, 'Шевченко', 'Вул Кобзаря'), true);
  const STREET_B = street('Шевченко', 'Вул Кобзаря');
  assert.ok(STREET_B && STREET_B.id !== KOBZ.id, 'B got its own permanent UUID (same name in Таромське is another street)');
  assert.equal(STREET_B.cityId, SHEV.id);
  /* 4) the next push (debounced on the phone) carries B — UNION merge in KV */
  const second = await (await phonePush(app)).json();
  assert.equal(second.streets, 5);
  /* 5) DIRECTORY question now sees A and B */
  dir = await call(app, 'list_directory', {city:'Шевченко'});
  assert.deepEqual(dir.streets.map(s => s.name), ['Вул Кобзаря', 'Вул Шевченко']);
  assert.deepEqual(dir.streets.map(s => s.street_id).sort(), [STREET_A.id, STREET_B.id].sort());
  /* 6) TICKETS question: only streets WITH tickets — B has none in Sheets yet */
  const places = await call(app, 'list_places', {city:'Шевченко'});
  assert.equal(places.source, 'tickets'); assert.equal(places.directory_available, true);
  assert.equal(places.places.length, 1);
  assert.equal(places.places[0].city_id, SHEV.id);
  assert.deepEqual(places.places[0].streets.map(s => [s.street, s.ticket_count, s.street_id]), [['Вул Шевченко', 2, STREET_A.id]],
    'the linked row and the legacy row are ONE street (attributed read-only), street B absent');
  const grouped = await call(app, 'query_tickets', {mode:'group', group_by:'street', city:'Шевченко'});
  assert.deepEqual(grouped.groups.map(g => [g.key, g.count]), [['Вул Шевченко', 2]]);
  assert.equal(grouped.directory.city_id, SHEV.id);
  assert.equal(grouped.resolved_filters.city_id, SHEV.id, 'the follow-up context carries the identity');
  /* directory listing without a city, and an unknown city */
  const cities = await call(app, 'list_directory', {});
  assert.deepEqual(cities.cities.map(c => [c.name, c.street_count]), [['Таромське', 2], ['Шевченко', 2], ['Ясний', 1]]);
  const unknown = await call(app, 'list_directory', {city:'Невідоме'});
  assert.equal(unknown.available, true); assert.equal(unknown.city, null); assert.equal(unknown.city_status, 'NO_MATCH');
  const byId = await call(app, 'list_directory', {city_id:TAROM.id});
  assert.equal(byId.city.name, 'Таромське'); assert.equal(byId.streets.length, 2);
});

test('UUID-first: alias city + linked rows by id, legacy rows by text; follow-up by city_id/street_id; rename keeps identity; archive stays findable', async () => {
  const f = fixture();
  const {book, street, TAROM, STREET_A, PRYV, KOBZ} = f;
  const app = await f.appWith();
  const phonePush = f.push;
  assert.equal((await phonePush(app)).status, 200);
  /* alias «Таромское» → cityId; rows are matched by identity, not spelling */
  const count = await call(app, 'query_tickets', {mode:'count', city:'Таромское'});
  assert.equal(count.matched, 4);
  assert.equal(count.directory.city_id, TAROM.id); assert.equal(count.directory.city, 'Таромське');
  assert.equal(count.directory.city_status, 'ALIAS_EXACT');
  assert.equal(count.resolved_filters.city_id, TAROM.id);
  /* follow-up purely by UUID (what «покажи їх» inherits) */
  const byId = await call(app, 'query_tickets', {mode:'list', city_id:TAROM.id, street_id:KOBZ.id});
  assert.deepEqual(byId.tickets.map(t => t.id).sort(), ['t-k10', 't-k15']);
  assert.ok(byId.tickets[0].match_reasons.includes('вулиця:довідник (id)'));
  assert.equal(byId.resolved_filters.street_id, KOBZ.id);
  /* an id this directory does not know is ignored in favour of the text */
  const foreign = await call(app, 'query_tickets', {mode:'count', city:'Таромське', city_id:'3c8f1d20-ffff-4bbb-8ccc-000000000001'});
  assert.equal(foreign.matched, 4); assert.equal(foreign.directory.city_id, TAROM.id);
  /* the same street name in two cities: the directory is scoped by city */
  AB.remember(book, 'Шевченко', 'Вул Кобзаря');
  assert.equal((await phonePush(app)).status, 200);
  const scoped = await call(app, 'query_tickets', {mode:'count', city:'Шевченко', street:'Кобзаря'});
  assert.equal(scoped.matched, 0, 'street B in Шевченко has no tickets — the Таромське rows are NOT pulled in');
  assert.equal(scoped.directory.street_id, street('Шевченко', 'Вул Кобзаря').id);
  const unscoped = await call(app, 'query_tickets', {mode:'count', street:'Кобзаря'});
  assert.equal(unscoped.directory.street_status, 'AMBIGUOUS');
  assert.deepEqual(unscoped.directory.street_candidates.sort(), ['Таромське — Вул Кобзаря', 'Шевченко — Вул Кобзаря']);
  assert.equal(unscoped.matched, 2, 'ambiguous in the directory → the Stage 1 text path decides (rows exist only in Таромське)');
  /* rename + alias: old spelling → alias → same streetId; the user sees the new name */
  AB.update(book, 'streets', PRYV.id, {name:'Вулиця Залізнична', aliases:['Вул Привокзальна', 'Привокзальная']});
  assert.equal((await phonePush(app)).status, 200);
  const renamed = await call(app, 'query_tickets', {mode:'list', city:'Таромське', street:'Привокзальная'});
  assert.equal(renamed.matched, 2);
  assert.equal(renamed.directory.street_id, PRYV.id); assert.equal(renamed.directory.street, 'Вулиця Залізнична');
  const newName = await call(app, 'query_tickets', {mode:'count', city:'Таромське', street:'Залізнична'});
  assert.equal(newName.matched, 2, 'the new name finds the old rows through the UUID, no text rewrite needed');
  const listed = await call(app, 'list_directory', {city:'Таромське'});
  assert.deepEqual(listed.streets.find(s => s.street_id === PRYV.id).aliases, ['Вул Привокзальна', 'Привокзальная']);
  const placesRenamed = await call(app, 'list_places', {city:'Таромське'});
  const renamedEntry = placesRenamed.places[0].streets.find(s => s.street_id === PRYV.id);
  assert.equal(renamedEntry.street, 'Вулиця Залізнична', 'TICKETS list shows the current name');
  assert.deepEqual(renamedEntry.raw_variants, ['Вул Привокзальна'], 'the historical spelling stays visible as a variant');
  /* archive: hidden from the default directory list, history still found */
  AB.update(book, 'streets', PRYV.id, {active:false});
  assert.equal((await phonePush(app)).status, 200);
  const dirDefault = await call(app, 'list_directory', {city:'Таромське'});
  assert.deepEqual(dirDefault.streets.map(s => s.name), ['Вул Кобзаря']);
  assert.equal(dirDefault.archived_street_count, 1);
  const dirAll = await call(app, 'list_directory', {city:'Таромське', include_archived:true});
  assert.equal(dirAll.streets.length, 2);
  const archivedRows = await call(app, 'query_tickets', {mode:'count', city:'Таромське', street:'Привокзальная'});
  assert.equal(archivedRows.matched, 2, 'archived street keeps its UUID and its historical tickets');
  AB.update(book, 'streets', PRYV.id, {active:true, name:'Вул Привокзальна', aliases:['Привокзальная']});
  /* a legacy row (no ids) on a linked street is grouped with it, never rewritten */
  const shev = await call(app, 'query_tickets', {mode:'list', city:'Шевченко', street:'Шевченко'});
  assert.deepEqual(shev.tickets.map(t => [t.id, t.streetId]).sort(), [['t-shev-1', STREET_A.id], ['t-shev-legacy', '']]);
  assert.deepEqual(shev.analytics.unique_streets, [{name:'Вул Шевченко', count:2}]);
});

test('production control phrases through find_tickets_by_address with the directory', async () => {
  const f = fixture();
  const {book, SHEV, TAROM, YASNY, KOBZ, NOVO} = f;
  const app = await f.appWith();
  const phonePush = f.push;
  assert.equal((await phonePush(app)).status, 200);
  /* «Кобзаря 10» / «Открой карточку Кобзаря 10» */
  const k10 = await call(app, 'find_tickets_by_address', {address:'Кобзаря 10'});
  assert.equal(k10.resolved.source, 'directory');
  assert.deepEqual([k10.resolved.city, k10.resolved.street, k10.resolved.house], ['Таромське', 'Вул Кобзаря', '10']);
  assert.equal(k10.resolved.street_id, KOBZ.id); assert.equal(k10.resolved.city_id, TAROM.id);
  assert.deepEqual(k10.tickets.map(t => t.id), ['t-k10']);
  assert.deepEqual(k10.houses, ['10', '15'], 'houses of the whole street, from tickets');
  /* «Привокзальная 3Б в каком городе находится?» → Таромське (alias → UUID) */
  const pryv = await call(app, 'find_tickets_by_address', {address:'Привокзальная 3Б'});
  assert.equal(pryv.resolved.city, 'Таромське'); assert.equal(pryv.resolved.city_id, TAROM.id);
  assert.equal(pryv.total_matched, 2);
  /* «Найди заявку Привокзальная 3Б квартира 1 в Таромском» — the structured path the model takes */
  const apt = await call(app, 'query_tickets', {mode:'list', city:'Таромском', street:'Привокзальная', house:'3Б', apartment:'1'});
  assert.deepEqual(apt.tickets.map(t => t.id), ['t-pryv-3b-1']);
  assert.equal(apt.directory.city_status, 'IDENTITY');
  /* «Новопокровская 37 в каком городе находится?» → city from the link/directory */
  const novo = await call(app, 'find_tickets_by_address', {address:'Новопокровская 37'});
  assert.equal(novo.resolved.city, 'Ясний'); assert.equal(novo.resolved.city_id, YASNY.id); assert.equal(novo.resolved.street_id, NOVO.id);
  assert.deepEqual(novo.tickets.map(t => t.id), ['t-n37']);
  /* a directory street with no tickets is still a real place, not «does not exist» */
  AB.remember(book, 'Шевченко', 'Вул Нова');
  assert.equal((await phonePush(app)).status, 200);
  const empty = await call(app, 'find_tickets_by_address', {address:'Шевченко Нова 5'});
  assert.equal(empty.resolved.source, 'directory'); assert.equal(empty.resolved.street, 'Вул Нова');
  assert.equal(empty.total_matched, 0);
  /* same street name in two cities without a city → candidates, never a guess */
  AB.remember(book, 'Шевченко', 'Вул Кобзаря');
  assert.equal((await phonePush(app)).status, 200);
  const ambiguous = await call(app, 'find_tickets_by_address', {address:'Кобзаря 10'});
  assert.equal(ambiguous.resolved.city, 'Таромське');
  assert.equal(ambiguous.resolved.source, undefined, 'answered by the Stage 1 ticket-derived path, not claimed as a directory resolution');
  assert.ok(ambiguous.directory && ambiguous.directory.ambiguous, 'the directory ambiguity is reported next to the Stage 1 answer');
  assert.deepEqual(ambiguous.directory.candidates.map(c => c.city).sort(), ['Таромське', 'Шевченко']);
  assert.deepEqual(ambiguous.tickets.map(t => t.id), ['t-k10'], 'Stage 1 (rows exist only in Таромське) still answers');
  const scoped = await call(app, 'find_tickets_by_address', {address:'Шевченко Кобзаря 10'});
  assert.equal(scoped.resolved.city_id, SHEV.id); assert.equal(scoped.total_matched, 0);
});

test('old snapshot without any directory keeps working; a later push does not invalidate it', async () => {
  const f = fixture();
  const {kv} = f;
  const app = await f.appWith();
  const phonePush = f.push;
  const before = await call(app, 'query_tickets', {mode:'count', city:'Таромское'});
  assert.equal(before.matched, 4, 'Stage 1 UA/RU bridging still answers without a directory');
  assert.equal('directory' in before, false);
  assert.ok(kv.map.has(snapshotKey()), 'the ticket snapshot was cached');
  const snapshotBefore = kv.map.get(snapshotKey());
  assert.equal((await call(app, 'list_directory', {city:'Таромське'})).available, false);
  assert.equal((await phonePush(app)).status, 200);
  assert.equal(kv.map.get(snapshotKey()), snapshotBefore, 'the ticket snapshot key is untouched by the directory push');
  const after = await call(app, 'list_directory', {city:'Таромське'});
  assert.equal(after.available, true);
  assert.equal(after.streets.length, 2);
});

test('/ask: the prompt separates DIRECTORY from TICKETS and teaches UUID-first follow-ups; both tools answer their own source', async () => {
  assert.match(ASK_SYSTEM_PROMPT, /11в\) ДОВІДНИК ≠ ЗАЯВКИ/);
  assert.match(ASK_SYSTEM_PROMPT, /list_directory/);
  assert.match(ASK_SYSTEM_PROMPT, /available=false[^\n]*вулиці із заявок, а не довідник/);
  assert.match(ASK_SYSTEM_PROMPT, /11г\) UUID-first/);
  assert.match(ASK_SYSTEM_PROMPT, /aliases — старі або інші написання/);
  const f = fixture();
  const {SHEV} = f;
  const app = await f.appWith();
  assert.equal((await f.push(app)).status, 200);
  const loaded = await app.appPromise;
  const seen = [];
  const scripted = steps => { let i = 0; return {chat:async function(){ const step = steps[Math.min(i, steps.length - 1)]; i++; return step; }}; };
  const callStep = (name, args) => ({ok:true, content:'', toolCalls:[{id:'c1', name, argsRaw:JSON.stringify(args)}], assistantMessage:{role:'assistant', content:'', tool_calls:[]}});
  const done = text => ({ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}});
  const tools = new Proxy(loaded.tools, {get(target, name){ return async function(args){ const out = await target[name](args); seen.push({name, args, out}); return out; }; }});
  await createAskOrchestrator({groq:scripted([callStep('list_directory', {city:'Шевченко'}), done('У довіднику Шевченко: Вул Шевченко.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('Какие улицы есть в Шевченко?', {chatSessionId:'chat-session-1'});
  await createAskOrchestrator({groq:scripted([callStep('query_tickets', {mode:'group', group_by:'street', city:'Шевченко'}), done('Заявки були на Вул Шевченко.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('На каких улицах Шевченко есть заявки?', {chatSessionId:'chat-session-2'});
  assert.equal(seen[0].name, 'list_directory');
  assert.equal(seen[0].out.data.source, 'directory');
  assert.deepEqual(seen[0].out.data.streets.map(s => s.name), ['Вул Шевченко']);
  assert.equal(seen[1].name, 'query_tickets');
  assert.deepEqual(seen[1].out.data.groups.map(g => g.key), ['Вул Шевченко']);
  assert.equal(seen[1].out.data.directory.city_id, SHEV.id);
});
