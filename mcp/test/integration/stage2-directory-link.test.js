/* Stage 2B — Worker side (additive only).
   The projection carries the optional directory link (cityId/streetId) and the
   address tools echo it ONLY when every matched row agrees. Pinned here:
     1) a linked row keeps the ids; a legacy row keeps the same field set with
        empty strings, so old and new rows share one shape;
     2) a non-UUID value is dropped instead of travelling as a half-trusted id;
     3) the ids never leak into the free-text search index;
     4) the snapshot cache moved to v4 and still ignores (and never deletes) the
        older KV keys;
     5) find_tickets_by_address adds city_id/street_id only for a unanimous set
        and stays byte-compatible for legacy rows. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {redactTicket, REDACTED_TICKET_FIELDS, ticketFromGasRow, searchableTextFromGasRow} from '../../src/gas/mappers.js';
const rowsTools = rows => createReadTools({data:createDataPipeline({getList:async function(){ return {ok:true, data:{tickets:rows, shifts:[]}}; }})});
import {SNAPSHOT_VERSION, snapshotKey} from '../../src/data/snapshot.js';
import {createReadTools, createDataPipeline} from '../../src/tools/read.js';
import {ASK_SYSTEM_PROMPT, createAskOrchestrator, cardIntentFor} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {hygieneArgs} from '../../src/ask/arg-hygiene.js';

const CITY_ID = '0f9ae2f2-1111-4222-8333-444455556666';
const STREET_ID = '0f9ae2f2-7777-4888-8999-aaaabbbbcccc';
const OTHER_STREET_ID = '1a2b3c4d-5555-4666-8777-888899990000';

function gasRow(id, full, extra){
  return Object.assign({id, date:'03.06.2026', time:'17:54', content:'', sum:0, tags:[], backupNote:'', photo:null,
    fullDataJson: JSON.stringify(full)}, extra || {});
}
const LINKED_ROW = gasRow('t-linked', {type:'Ремонт', city:'Таромське', street:'Вул Привокзальна', house:'3б', apartment:'1',
  address:'Таромське, Вул Привокзальна 3б, кв. 1', cityId:CITY_ID, streetId:STREET_ID});
const LEGACY_ROW = gasRow('t-legacy', {type:'Ремонт', city:'Таромське', street:'Вул Привокзальна', house:'5',
  address:'Таромське, Вул Привокзальна 5'});
const OTHER_ROW = gasRow('t-other', {type:'Ремонт', city:'Таромське', street:'Вул Садова', house:'19',
  address:'Таромське, Вул Садова 19', cityId:CITY_ID, streetId:OTHER_STREET_ID});

test('stage2: projection is additive — ids for linked rows, empty strings for legacy rows', () => {
  const linked = redactTicket(ticketFromGasRow(LINKED_ROW));
  assert.equal(linked.cityId, CITY_ID);
  assert.equal(linked.streetId, STREET_ID);
  assert.equal(linked.city, 'Таромське', 'the historical text stays authoritative for display');
  const legacy = redactTicket(ticketFromGasRow(LEGACY_ROW));
  assert.equal(legacy.cityId, '');
  assert.equal(legacy.streetId, '');
  assert.deepEqual(Object.keys(linked).sort(), REDACTED_TICKET_FIELDS.slice().sort(), 'one shape for old and new rows');
  assert.deepEqual(Object.keys(legacy).sort(), REDACTED_TICKET_FIELDS.slice().sort());
});

test('stage2: only a UUID is accepted as a directory id — nothing is derived from text', () => {
  const cases = [
    ['Таромське', ''],
    ['not-a-uuid', ''],
    ['0f9ae2f2-1111-4222-8333', ''],
    [null, ''],
    [12345, '']
  ];
  for(const [value, expected] of cases){
    const row = gasRow('t-bad', {type:'Ремонт', city:'Таромське', street:'Вул Садова', house:'1', cityId:value, streetId:value});
    const redacted = redactTicket(ticketFromGasRow(row));
    assert.equal(redacted.cityId, expected, 'rejected: ' + JSON.stringify(value));
    assert.equal(redacted.streetId, expected);
  }
  const upper = gasRow('t-upper', {type:'Ремонт', city:'Таромське', street:'Вул Садова', house:'1', cityId:CITY_ID.toUpperCase(), streetId:STREET_ID.toUpperCase()});
  assert.equal(redactTicket(ticketFromGasRow(upper)).cityId, CITY_ID.toUpperCase(), 'case is preserved, never rewritten');
});

test('stage2: ids never enter the free-text search index', async () => {
  const mapped = ticketFromGasRow(LINKED_ROW);
  const index = String(searchableTextFromGasRow(LINKED_ROW, mapped.fullData));
  assert.equal(index.includes(CITY_ID), false, 'the directory id never becomes searchable text');
  assert.equal(index.includes(STREET_ID), false);
  /* the pipeline hands the tools the SAME derived index — ids cannot appear
     there either, whatever the row carries */
  const pipeline = createDataPipeline({getList:async function(){ return {ok:true, data:{tickets:[LINKED_ROW], shifts:[]}}; }});
  const loaded = await pipeline.getList();
  assert.equal(JSON.stringify(loaded.data.searchIndex).includes(CITY_ID), false);
  assert.equal(JSON.stringify(loaded.data.searchIndex).includes(STREET_ID), false);
});

test('stage2: snapshot cache is v4 and the older keys stay untouched', () => {
  assert.equal(SNAPSHOT_VERSION, 4);
  assert.equal(snapshotKey(), 'mt:snapshot:v4');
});

test('stage2: find_tickets_by_address echoes ids only for a unanimous set', async () => {
  const pryv = (id, streetId, house, apartment) => gasRow(id, {type:'Ремонт', city:'Таромське', street:'Вул Привокзальна',
    house, apartment, address:'Таромське, Вул Привокзальна ' + house + (apartment ? ', кв. ' + apartment : ''), cityId:CITY_ID, streetId});

  /* two rows that share the street TEXT but were linked to two different
     directory streets (duplicated directory entry / manual repair): the tool
     must not pick one of them — the street identity claim is simply omitted */
  const conflict = rowsTools([pryv('t-a', STREET_ID, '3б', '1'), pryv('t-b', OTHER_STREET_ID, '3в', '2')]);
  const conflictResult = await conflict.find_tickets_by_address({address:'Таромське Вул Привокзальна'});
  assert.equal(conflictResult.data.total_matched, 2);
  assert.equal(conflictResult.data.resolved.street, 'Вул Привокзальна', 'text resolution is unchanged');
  assert.equal(conflictResult.data.resolved.street_id, undefined, 'conflicting ids → no identity claim');
  assert.equal(conflictResult.data.resolved.city_id, CITY_ID, 'the city identity is still shared by both rows');

  /* one legacy row inside the set cancels every identity claim */
  const mixed = rowsTools([pryv('t-linked', STREET_ID, '3б', '1'), gasRow('t-legacy-2', {type:'Ремонт', city:'Таромське',
    street:'Вул Привокзальна', house:'3в', address:'Таромське, Вул Привокзальна 3в'})]);
  const mixedResult = await mixed.find_tickets_by_address({address:'Таромське Вул Привокзальна'});
  assert.equal(mixedResult.data.total_matched, 2);
  assert.equal(mixedResult.data.resolved.city_id, undefined, 'a legacy row means no identity claim at all');
  assert.equal(mixedResult.data.resolved.street_id, undefined);

  /* a fully linked, uniform set echoes both ids and keeps house resolution */
  const uniform = rowsTools([pryv('t-linked', STREET_ID, '3б', '1'), pryv('t-linked-2', STREET_ID, '3б', '2')]);
  const uniformResult = await uniform.find_tickets_by_address({address:'Таромське Вул Привокзальна 3б'});
  assert.equal(uniformResult.data.total_matched, 2);
  assert.equal(uniformResult.data.resolved.city_id, CITY_ID);
  assert.equal(uniformResult.data.resolved.street_id, STREET_ID);
  assert.equal(uniformResult.data.resolved.house, '3б');

  /* the linked row is still found by address exactly as before */
  const single = rowsTools([LINKED_ROW]);
  const singleResult = await single.find_tickets_by_address({address:'Таромське Вул Привокзальна 3б квартира 1'});
  assert.equal(singleResult.data.total_matched, 1);
  assert.equal(singleResult.data.resolved.city_id, CITY_ID);
  assert.equal(singleResult.data.resolved.street_id, STREET_ID);
  assert.equal(singleResult.data.tickets[0].city, 'Таромське', 'the historical text rides along untouched');
});

test('stage2: legacy data keeps working exactly as before', async () => {
  const tools = rowsTools([LEGACY_ROW]);
  const listed = await tools.list_tickets({});
  assert.equal(listed.data.total_matched, 1);
  assert.equal(listed.data.tickets[0].cityId, '');
  const search = await tools.search_tickets({query:'Привокзальна'});
  assert.equal(search.data.total_matched, 1, 'the legacy row is still findable by text');
  const found = await tools.find_tickets_by_address({address:'Таромське Вул Привокзальна 5'});
  assert.equal(found.data.total_matched, 1);
  assert.equal(found.data.resolved.city, 'Таромське');
  assert.equal(found.data.resolved.city_id, undefined, 'no ids invented for a legacy row');
});

test('stage2: the /ask prompt treats directory ids as authoritative but never prints them', () => {
  const lines = ASK_SYSTEM_PROMPT.split('\n').filter(function(line){ return line.startsWith('11'); });
  const identity = lines.find(function(line){ return line.startsWith('11б)'); });
  assert.ok(identity, 'the identity rule ships inside the real /ask prompt');
  assert.match(identity, /cityId\/streetId/, 'the directory fields are named');
  assert.match(identity, /авторитетн/i, 'ids outrank the text spelling');
  assert.match(identity, /стар(их|і)/i, 'legacy rows without ids keep the text fallback');
  assert.match(identity, /ніколи не друкуй id/i, 'UUIDs never reach the answer text');
  const directory = lines.find(function(line){ return line.startsWith('11в)'); });
  assert.ok(directory, 'the DIRECTORY vs TICKETS rule ships too');
  assert.match(directory, /list_places/, 'the directory question is bound to a real tool');
  assert.match(directory, /заявок за цією вулицею не знайдено|заявок.*не знайдено/i, 'and refuses to claim a street does not exist');
  assert.match(ASK_SYSTEM_PROMPT, /11а\)/, 'the Stage 1 address routing rule is untouched');
  assert.ok(ASK_SYSTEM_PROMPT.includes('search_tickets') && ASK_SYSTEM_PROMPT.includes('query_tickets'), 'routing vocabulary unchanged');
});
