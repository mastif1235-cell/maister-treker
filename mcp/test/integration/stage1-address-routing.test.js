/* v91.52 Stage-1 address ROUTING fix — regression suite (R1–R6).

   The production audit proved an address question («Привокзальная 3Б в
   Таромском») ends in ZERO rows when the model picks the free-text tool: the
   app-parity predicate behind search_tickets is a literal substring over
   [date, city, address, clientName, tags] — it has no street/house structure
   and no RU↔UA folding, so «Привокзальная» never matches the stored
   «Вул Привокзальна». The structured paths (query_tickets with argument
   hygiene, find_tickets_by_address) find the very same row.

   This pass is therefore a ROUTING fix only: ONE rule in the /ask system
   prompt sends address questions to query_tickets / find_tickets_by_address
   and keeps search_tickets for free text, phones, tags and notes. The search
   engine, the predicates, F1–F4, resultSet and selectedTicketId are untouched.

   What these tests can and cannot pin: a real model is never called here, so
   "the model followed the rule" is a production property, not a unit-test one.
   What IS pinned: (R1) every /ask turn really carries the rule to the model and
   the rule contains no street special-case; (R2) the rule is a rule, not a
   block — free-text questions still reach search_tickets and their rows still
   come back; (R3) the address paths really find the synthetic production ticket
   for both production phrases (and the free-text limitation is pinned as the
   reason for the rule); (R4) «у якому місті ця адреса» resolves the city
   structurally; (R5) an open-by-address turn still ends in ONE exact card (F4);
   (R6) the public /mcp contract is untouched.

   All fixtures are synthetic (the v91.52 audit matrix), never production rows. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createReadTools, createDataPipeline} from '../../src/tools/read.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';
import {createAskOrchestrator, cardIntentFor, ASK_SYSTEM_PROMPT} from '../../src/ask/orchestrator.js';
import {hygieneArgs} from '../../src/ask/arg-hygiene.js';

/* ---------- synthetic fixtures + harnesses ---------- */

function gasRow(id, full, extra){
  return Object.assign({id, date:'10.06.2026', time:'10:00', content:'', sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify(full), photo:null}, extra || {});
}

function toolsFrom(rows){
  /* the real REDACTION pipeline the Worker uses, on top of the same GAS row
     shape the tools see in production */
  return createReadTools({data:createDataPipeline({
    getList: async function(){ return {ok:true, data:{tickets:rows, shifts:[]}}; }
  })});
}

function call(name, args, id = 'c1'){
  return {ok:true, content:'', toolCalls:[{id, name, argsRaw:JSON.stringify(args)}], assistantMessage:{role:'assistant', content:'', tool_calls:[]}};
}
function done(text = 'Готово.'){ return {ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}}; }
function groq(steps){ let i = 0; return {calls:0, chat:async function(){ this.calls++; const step = steps[Math.min(i, steps.length - 1)]; i++; return step; }}; }

/* The production address of the audit (synthetic row, synthetic neighbours). */
const PRYV = [
  gasRow('t-pryv-3b-1', {type:'Ремонт', city:'Таромское', street:'Вул Привокзальна', house:'3б', apartment:'1', address:'Таромское, Вул Привокзальна 3б, кв. 1'}),
  gasRow('t-pryv-3b-2', {type:'Ремонт', city:'Таромское', street:'Вул Привокзальна', house:'3б', apartment:'2', address:'Таромское, Вул Привокзальна 3б, кв. 2'}),
  gasRow('t-pryv-5', {type:'Підключення', city:'Таромское', street:'Вул Привокзальна', house:'5', address:'Таромское, Вул Привокзальна 5'}),
  gasRow('t-sadova-19', {type:'Ремонт', city:'Таромское', street:'Вул Садова', house:'19', address:'Таромское, Вул Садова 19'})
];

const KOBZAR = [
  gasRow('t-k15', {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house:'15', apartment:'1', address:'Таромское, Вул Кобзаря 15, кв. 1'}),
  gasRow('t-k17', {type:'Ремонт', city:'Таромское', street:'Вул Кобзаря', house:'17', address:'Таромское, Вул Кобзаря 17'}),
  gasRow('t-k19', {type:'Підключення', city:'Таромское', street:'Вул Кобзаря', house:'19', address:'Таромское, Вул Кобзаря 19'})
];

const NOVOPOKROVSKA = [
  gasRow('t-n37', {type:'Ремонт', city:'Ясний', street:'Вул Новопокровська', house:'37', address:'Ясний, Вул Новопокровська 37'}),
  gasRow('t-n39', {type:'Підключення', city:'Ясний', street:'Вул Новопокровська', house:'39', address:'Ясний, Вул Новопокровська 39'})
];

/* ---------- R1: the rule reaches the model on every turn ---------- */

const ADDRESS_PHRASES = [
  'Найди заявку Привокзальная 3Б в Таромском',
  'Найди заявку Привокзальная 3Б квартира 1 в Таромском',
  'В каком городе находится Новопокровская 37',
  'Открой заявку Кобзаря 15'
];

test('R1: every /ask turn sends the address-routing rule to the model', async () => {
  const systems = [];
  const orchestrator = createAskOrchestrator({
    groq:{chat:async function(messages){ systems.push(messages[0].content); return done('ок'); }},
    tools:{}, toolDefs:TOOL_DEFINITIONS
  });
  for(const phrase of ADDRESS_PHRASES){
    await orchestrator.handle(phrase, {chatSessionId:'chat-session-1'});
  }
  assert.equal(systems.length, ADDRESS_PHRASES.length, 'one system message per turn');

  for(const system of systems){
    assert.ok(system.startsWith(ASK_SYSTEM_PROMPT), 'the rule ships inside the real /ask prompt');
    assert.match(system, /11а\) Адресні питання/, 'address questions have their own routing rule');
    assert.match(system, /шукай ТІЛЬКИ через query_tickets \(окремі поля city\/street\/house\/apartment\) або find_tickets_by_address/, 'the two address tools are named');
    assert.match(system, /НЕ роби search_tickets основним шляхом для адресних питань/, 'search_tickets is explicitly not the address path');
    assert.match(system, /не передавай у нього вулицю\/будинок\/адресу/, 'the free-text tool must not receive address fields');
    assert.match(system, /search_tickets — це лише вільний текст заявки, телефон, теги, нотатки, абонент та інші неструктуровані поля/, 'free-text scope stays spelled out');
  }
});

test('R1b: the routing rule carries no street special-case and no engine constant', () => {
  const rule = ASK_SYSTEM_PROMPT.split('\n').filter(function(line){ return line.startsWith('11а)'); });
  assert.equal(rule.length, 1, 'exactly one routing rule');
  const text = rule[0];
  const body = text.replace(/^11а\)\s*/, '');
  assert.ok(!/(Привокзальн|Кобзаря|Мостова|Садова|Новопокровськ|Таромськ)/i.test(body), 'no street/city special-case inside the rule');
  assert.ok(!/\\|\|/.test(body), 'no regex syntax inside the rule');
  assert.ok(!/\d/.test(body), 'no numeric constant inside the rule');
  assert.match(text, /query_tickets/);
  assert.match(text, /find_tickets_by_address/);
});

/* ---------- R2: free text still reaches search_tickets ---------- */

test('R2: the rule does not block free-text questions (phones, tags, notes, plain text)', async () => {
  const cases = [
    {phrase:'Найди заявку где написано красный лосс', args:{query:'красный лосс'}},
    {phrase:'Найди по телефону 0681234567', args:{query:'0681234567'}},
    {phrase:'Покажи заявки с тегом ремонт', args:{query:'ремонт'}},
    {phrase:'Найди заявку где в заметке написано кабель', args:{query:'кабель'}}
  ];
  for(const item of cases){
    const seen = [];
    const out = await createAskOrchestrator({
      groq:groq([call('search_tickets', item.args), done('…')]),
      tools:{search_tickets:async function(args){
        seen.push(args);
        return {ok:true, data:{tickets:[
          {id:'t-free-1', date:'10.06.2026', time:'10:00', city:'Ясний', street:'Вул Новопокровська', house:'37', address:'Ясний, Вул Новопокровська 37', type:'Ремонт', sum:100}
        ], total_matched:1, returned:1, offset:0, limit:50}};
      }},
      toolDefs:TOOL_DEFINITIONS
    }).handle(item.phrase, {chatSessionId:'chat-session-1'});

    assert.equal(seen.length, 1, 'search_tickets is still callable for: ' + item.phrase);
    assert.deepEqual(seen[0], item.args, 'arguments are passed through untouched');
    assert.equal(out.total, 1, 'its rows still reach the turn');
    assert.equal(out.presentation, null, 'a free-text answer opens no card by itself');
  }
});

/* ---------- R3: the address paths find the production ticket ---------- */

test('R3: production phrase 1 — street+house goes through the address path and finds the row', async () => {
  const tools = toolsFrom(PRYV);

  /* the model's raw shape (house glued to the street, RU spelling): the engine
     alone sees no such street — this is the production 0 the routing rule must
     prevent, and the hygiene pass repairs it inside /ask */
  const raw = await tools.query_tickets({mode:'list', city:'Таромском', street:'Привокзальная 3Б'});
  assert.equal(raw.data.total_matched, 0);

  const hygienised = hygieneArgs('query_tickets', {mode:'list', city:'Таромском', street:'Привокзальная 3Б'});
  assert.deepEqual(hygienised, {mode:'list', city:'Таромском', street:'Привокзальная', house:'3Б'});
  const viaQuery = await tools.query_tickets(hygienised);
  assert.ok(viaQuery.data.total_matched >= 1);
  assert.ok(viaQuery.data.tickets.some(function(row){ return row.id === 't-pryv-3b-1'; }), 'the ticket is in the structured result');

  /* the same phrase handed to the address tool as one string */
  const viaAddress = await tools.find_tickets_by_address({address:'Привокзальная 3Б в Таромском'});
  assert.equal(viaAddress.data.resolved.city, 'Таромское');
  assert.equal(viaAddress.data.resolved.street, 'Вул Привокзальна');
  assert.ok(viaAddress.data.tickets.some(function(row){ return row.id === 't-pryv-3b-1'; }));
});

test('R3b: production phrase 2 — apartment 1 resolves through the address path', async () => {
  const tools = toolsFrom(PRYV);

  const hygienised = hygieneArgs('query_tickets', {mode:'list', city:'Таромском', street:'Привокзальная 3Б', apartment:'квартира 1'});
  assert.equal(hygienised.apartment, '1');
  assert.equal(hygienised.house, '3Б');
  const viaQuery = await tools.query_tickets(hygienised);
  assert.equal(viaQuery.data.total_matched, 1);
  assert.equal(viaQuery.data.tickets[0].id, 't-pryv-3b-1', 'apartment 1 picks the flat, not the neighbour');

  /* the free-string tool narrows by city+street and returns the street's rows
     (including the target), but the apartment is NOT part of its resolution:
     `resolved.house` stays null for this phrasing. The apartment narrowing is
     the structured path's job — which is exactly why the routing rule sends
     field-addressable questions to query_tickets first. */
  const viaAddress = await tools.find_tickets_by_address({address:'Привокзальная 3Б квартира 1 в Таромском'});
  assert.equal(viaAddress.data.resolved.city, 'Таромское');
  assert.equal(viaAddress.data.resolved.street, 'Вул Привокзальна');
  assert.equal(viaAddress.data.resolved.house, null, 'the apartment tail is not a house for the free-string resolver');
  assert.equal(viaAddress.data.total_matched, 3);
  assert.ok(viaAddress.data.tickets.some(function(row){ return row.id === 't-pryv-3b-1'; }), 'the ticket itself is in the rows');
});

test('R3c: why the route matters — the free-text predicate is literal (engine untouched by design)', async () => {
  const tools = toolsFrom(PRYV);
  /* the exact call that produced the production «такої заявки немає» */
  const ru = await tools.search_tickets({query:'Привокзальная 3Б'});
  assert.equal(ru.data.total_matched, 0, 'RU spelling never matches the stored UA street in free text');
  /* and the same predicate on the matching spelling — proof it is the spelling,
     not a missing row */
  const ua = await tools.search_tickets({query:'Привокзальна 3б'});
  assert.equal(ua.data.total_matched, 2);
  assert.ok(ua.data.tickets.some(function(row){ return row.id === 't-pryv-3b-1'; }));
});

/* ---------- R4: «у якому місті ця адреса» — structural resolution ---------- */

test('R4: the city of an address comes back structurally, not as free text', async () => {
  const tools = toolsFrom(NOVOPOKROVSKA);
  const viaAddress = await tools.find_tickets_by_address({address:'Новопокровская 37'});
  assert.equal(viaAddress.data.total_matched, 1);
  assert.equal(viaAddress.data.resolved.city, 'Ясний');
  assert.equal(viaAddress.data.resolved.street, 'Вул Новопокровська');
  assert.equal(viaAddress.data.tickets[0].id, 't-n37');

  /* the structured twin of the same question */
  const structured = await tools.query_tickets(hygieneArgs('query_tickets', {mode:'list', street:'Новопокровская 37'}));
  assert.equal(structured.data.total_matched, 1);
  assert.equal(structured.data.tickets[0].city, 'Ясний');

  /* and through a turn: the address tool is the one that carries the answer */
  const seen = [];
  const out = await createAskOrchestrator({
    groq:groq([call('find_tickets_by_address', {address:'Новопокровская 37'}), done('Ця адреса в Ясному.')]),
    tools:{find_tickets_by_address:async function(args){ seen.push(args); return tools.find_tickets_by_address(args); }},
    toolDefs:TOOL_DEFINITIONS
  }).handle('В каком городе находится Новопокровская 37', {chatSessionId:'chat-session-1'});
  assert.deepEqual(seen, [{address:'Новопокровская 37'}]);
  assert.equal(out.total, 1);
  assert.equal(out.presentation, null, 'a city question opens no card');
});

/* ---------- R5: open-by-address still ends in ONE exact card (F4) ---------- */

test('R5: «Открой заявку Кобзаря 15» — address path first, then the F4 exact card', async () => {
  const tools = toolsFrom(KOBZAR);
  assert.equal(cardIntentFor('Открой заявку Кобзаря 15'), 'open');

  /* both address routes the rule allows bring the street's rows, and F4 picks
     the single exact one — the «similar» houses never reach the UI */
  for(const route of [
    {tool:'find_tickets_by_address', args:{address:'Кобзаря'}},
    {tool:'query_tickets', args:{mode:'list', city:'Таромское', street:'Кобзаря'}}
  ]){
    const seen = [];
    const toolsMap = {};
    toolsMap[route.tool] = async function(args){ seen.push(args); return tools[route.tool](args); };
    const out = await createAskOrchestrator({groq:groq([call(route.tool, route.args), done('Відкриваю.')]), tools:toolsMap, toolDefs:TOOL_DEFINITIONS})
      .handle('Открой заявку Кобзаря 15', {chatSessionId:'chat-session-1'});
    assert.equal(seen.length, 1, route.tool + ' was the tool actually called');
    assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'t-k15'}, 'exactly one exact match → one card (' + route.tool + ')');
    assert.equal(out.selectedTicketId, 't-k15');
    assert.deepEqual(out.tickets, [], 'no «similar» cards next to the single card');
  }

  /* a LIST request stays a list — the routing rule must not turn it into F4 */
  const listed = await createAskOrchestrator({
    groq:groq([call('find_tickets_by_address', {address:'Кобзаря'}), done('Ось заявки.')]),
    tools:{find_tickets_by_address:async function(args){ return tools.find_tickets_by_address(args); }},
    toolDefs:TOOL_DEFINITIONS
  }).handle('Покажи заявки Кобзаря 15', {chatSessionId:'chat-session-1'});
  assert.equal(listed.presentation, null);
  assert.equal(listed.total, 3);
});

/* ---------- R6: public /mcp contract untouched ---------- */

test('R6: the routing fix stays inside /ask — the public /mcp toolset is unchanged', () => {
  assert.equal(TOOL_DEFINITIONS.length, 12);
  assert.deepEqual(TOOL_DEFINITIONS.map(function(def){ return def.name; }), [
    'list_tickets', 'get_ticket', 'search_tickets', 'query_tickets', 'list_catalog',
    'find_tickets_by_address', 'list_places', 'list_directory', 'get_tickets_by_date', 'get_shifts',
    'get_reports', 'get_statistics'
  ]);
  const search = TOOL_DEFINITIONS.find(function(def){ return def.name === 'search_tickets'; });
  assert.deepEqual(search.inputSchema.required, ['query']);
  assert.deepEqual(Object.keys(search.inputSchema.properties),
    ['query', 'terms', 'item_conditions', 'sum_min', 'sum_max', 'payment', 'date_from', 'date_to', 'limit', 'offset']);
  /* the routing sentence is a /ask prompt rule only */
  for(const def of TOOL_DEFINITIONS){
    assert.ok(!/основним шляхом|11а\)/.test(String(def.description || '')), 'no routing rule leaked into ' + def.name);
  }
});
