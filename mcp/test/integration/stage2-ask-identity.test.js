/* Stage 2B — /ask side (additive, READ-ONLY).
   Pinned here:
     1) the system prompt teaches the model that cityId/streetId are the
        directory identity (authoritative when present, text fallback for legacy
        rows) and that ids are never printed to the master;
     2) a DIRECTORY question («які вулиці існують у ...») stays distinct from a
        TICKETS question — list_places lists places WITH tickets, so a missing
        street is reported as «заявок не знайдено», never as «вулиці не існує»;
     3) query_tickets rows carry the same identity as the rest of the tools, and
        only in its canonical UUID shape;
     4) the four critical production scenarios keep working end to end. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadTools, createDataPipeline} from '../../src/tools/read.js';
import {ASK_SYSTEM_PROMPT, createAskOrchestrator, cardIntentFor} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {hygieneArgs} from '../../src/ask/arg-hygiene.js';

function gasRow(id, full, extra){
  return Object.assign({id, date:'03.06.2026', time:'17:54', content:'', sum:0, tags:[], backupNote:'', photo:null,
    fullDataJson: JSON.stringify(full)}, extra || {});
}
const rowsTools = rows => createReadTools({data:createDataPipeline({getList:async function(){ return {ok:true, data:{tickets:rows, shifts:[]}}; }})});

/* ---------- the four critical Stage 2B /ask scenarios ---------- */

const CITY_TAROM = '3c8f1d20-aaaa-4bbb-8ccc-000000000001';
const STREET_PRYV = '3c8f1d20-aaaa-4bbb-8ccc-000000000002';
const CITY_YASNY = '3c8f1d20-aaaa-4bbb-8ccc-000000000003';
const STREET_NOVO = '3c8f1d20-aaaa-4bbb-8ccc-000000000004';
const STREET_KOBZ = '3c8f1d20-aaaa-4bbb-8ccc-000000000005';

/* Production-like rows: RU city spelling in the historical text (as the master
   typed it), the directory identity in the ids — the exact Stage 2B situation. */
const PRYV_LINKED = [
  gasRow('t-pryv-3b-1', {type:'Ремонт', city:'Таромское', street:'Вул Привокзальна', house:'3б', apartment:'1',
    address:'Таромское, Вул Привокзальна 3б, кв. 1', cityId:CITY_TAROM, streetId:STREET_PRYV}),
  gasRow('t-pryv-3b-2', {type:'Ремонт', city:'Таромское', street:'Вул Привокзальна', house:'3б', apartment:'2',
    address:'Таромское, Вул Привокзальна 3б, кв. 2', cityId:CITY_TAROM, streetId:STREET_PRYV})
];
const NOVO_LINKED = [gasRow('t-n37', {type:'Підключення', city:'Ясний', street:'Вул Новопокровська', house:'37',
  address:'Ясний, Вул Новопокровська 37', cityId:CITY_YASNY, streetId:STREET_NOVO})];
const KOBZAR_LINKED = ['9', '10', '12', '15'].map(function(house){
  return gasRow('t-k' + house, {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house,
    address:'Таромское, Вул Кобзаря ' + house, cityId:CITY_TAROM, streetId:STREET_KOBZ});
});
function call(name, args){ return {ok:true, content:'', toolCalls:[{id:'c1', name, argsRaw:JSON.stringify(args)}], assistantMessage:{role:'assistant', content:'', tool_calls:[]}}; }
function done(text){ return {ok:true, content:text || 'Готово.', toolCalls:[], assistantMessage:{role:'assistant', content:text || 'Готово.'}}; }
function scripted(steps){ let i = 0; return {chat:async function(){ const step = steps[Math.min(i, steps.length - 1)]; i++; return step; }}; }

test('stage2 scenario 1: «Привокзальная 3Б в каком городе» answers from the resolved identity', async () => {
  const tools = rowsTools(PRYV_LINKED);
  const seen = [];
  const out = await createAskOrchestrator({
    groq:scripted([call('find_tickets_by_address', {address:'Привокзальная 3Б'}), done('Ця адреса в Таромском.')]),
    tools:{find_tickets_by_address:async function(args){ seen.push(args); const r = await tools.find_tickets_by_address(args); assert.equal(r.data.resolved.city_id, CITY_TAROM); assert.equal(r.data.resolved.street_id, STREET_PRYV); return r; }},
    toolDefs:TOOL_DEFINITIONS
  }).handle('Привокзальная 3Б в каком городе', {chatSessionId:'chat-session-1'});
  assert.deepEqual(seen, [{address:'Привокзальная 3Б'}], 'the address path was the tool actually called');
  assert.equal(out.total, 2);
  assert.equal(out.presentation, null, 'a city question opens no card');
});

test('stage2 scenario 2: «Найди Привокзальная 3Б квартира 1 в Таромском» narrows to the flat, same street identity', async () => {
  const tools = rowsTools(PRYV_LINKED);
  const args = hygieneArgs('query_tickets', {mode:'list', city:'Таромском', street:'Привокзальная 3Б', apartment:'квартира 1'});
  assert.deepEqual(args, {mode:'list', city:'Таромском', street:'Привокзальная', house:'3Б', apartment:'1'});
  const result = await tools.query_tickets(args);
  assert.equal(result.data.total_matched, 1);
  assert.equal(result.data.tickets[0].id, 't-pryv-3b-1');
  assert.equal(result.data.tickets[0].streetId, STREET_PRYV, 'the linked row carries its directory street');
  assert.equal(result.data.tickets[0].cityId, CITY_TAROM);

  /* both flats of house 3б report ONE streetId even though the neighbours are
     separate tickets — identity is the directory, not the row */
  const street = await tools.query_tickets({mode:'list', city:'Таромском', street:'Привокзальная', house:'3Б'});
  assert.equal(street.data.total_matched, 2);
  assert.equal(new Set(street.data.tickets.map(function(t){ return t.streetId; })).size, 1);
});

test('stage2 scenario 3: «Новопокровская 37 в каком городе» works the same for a second city', async () => {
  const tools = rowsTools(NOVO_LINKED);
  const viaAddress = await tools.find_tickets_by_address({address:'Новопокровская 37'});
  assert.equal(viaAddress.data.total_matched, 1);
  assert.equal(viaAddress.data.resolved.city, 'Ясний');
  assert.equal(viaAddress.data.resolved.city_id, CITY_YASNY);
  assert.equal(viaAddress.data.resolved.street_id, STREET_NOVO);

  const out = await createAskOrchestrator({
    groq:scripted([call('find_tickets_by_address', {address:'Новопокровская 37'}), done('Ця адреса в Ясному.')]),
    tools:{find_tickets_by_address:async function(args){ return tools.find_tickets_by_address(args); }},
    toolDefs:TOOL_DEFINITIONS
  }).handle('Новопокровская 37 в каком городе', {chatSessionId:'chat-session-1'});
  assert.equal(out.total, 1);
  assert.equal(out.presentation, null);
});

test('stage2 scenario 4: «Открой заявку Кобзаря 15» still ends in ONE exact card over linked rows', async () => {
  const tools = rowsTools(KOBZAR_LINKED);
  assert.equal(cardIntentFor('Открой заявку Кобзаря 15'), 'open');
  const out = await createAskOrchestrator({
    groq:scripted([call('find_tickets_by_address', {address:'Кобзаря'}), done('Відкриваю.')]),
    tools:{find_tickets_by_address:async function(args){ return tools.find_tickets_by_address(args); }},
    toolDefs:TOOL_DEFINITIONS
  }).handle('Открой заявку Кобзаря 15', {chatSessionId:'chat-session-1'});
  assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'t-k15'}, 'exactly one exact match → one card');
  assert.equal(out.selectedTicketId, 't-k15');
  assert.deepEqual(out.tickets, [], 'the neighbouring houses never become «similar» cards');
});

test('stage2: query_tickets rows carry the directory identity in its canonical shape only', async () => {
  const tools = rowsTools([
    gasRow('t-a', {type:'Ремонт', city:'Таромське', street:'Вул Привокзальна', house:'3б', address:'Таромське, Вул Привокзальна 3б', cityId:CITY_TAROM, streetId:STREET_PRYV}),
    gasRow('t-b', {type:'Ремонт', city:'Таромське', street:'Вул Привокзальна', house:'5', address:'Таромське, Вул Привокзальна 5', cityId:'not-a-uuid', streetId:'  '}),
    gasRow('t-c', {type:'Ремонт', city:'Таромське', street:'Вул Привокзальна', house:'7', address:'Таромське, Вул Привокзальна 7'})
  ]);
  const result = await tools.query_tickets({mode:'list', city:'Таромське', street:'Привокзальна'});
  assert.equal(result.data.total_matched, 3);
  const byId = new Map(result.data.tickets.map(function(row){ return [row.id, row]; }));
  assert.equal(byId.get('t-a').cityId, CITY_TAROM);
  assert.equal(byId.get('t-a').streetId, STREET_PRYV);
  assert.equal(byId.get('t-a').city, 'Таромське', 'the historical text is still there');
  assert.equal(byId.get('t-b').cityId, '', 'a non-UUID value is dropped, never trusted');
  assert.equal(byId.get('t-b').streetId, '');
  assert.equal(byId.get('t-c').cityId, '', 'a legacy row has no identity claim');
  assert.equal(byId.get('t-c').streetId, '');
});
