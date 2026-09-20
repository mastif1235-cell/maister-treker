import test from 'node:test';
import assert from 'node:assert/strict';

import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {createResultSet, sanitizeIncomingResultSet} from '../../src/ask/result-set.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';

function call(name, args, id='c1'){
  return {ok:true,content:'',toolCalls:[{id,name,argsRaw:JSON.stringify(args)}],assistantMessage:{role:'assistant',content:'',tool_calls:[]}};
}
function done(text='ok'){ return {ok:true,content:text,toolCalls:[],assistantMessage:{role:'assistant',content:text}}; }
function groq(steps){ let i=0; return {chat:async()=>steps[i++]}; }

test('one unique query_tickets list result is the only authoritative result source', async () => {
  const tools = {
    query_tickets:async()=>({ok:true,data:{mode:'list',resolved_filters:{city:'X'},total_matched:2,tickets:[{id:'A:1',date:'01.01.2026'},{id:'B.2',date:'02.01.2026'}]}})
  };
  const out = await createAskOrchestrator({groq:groq([call('query_tickets',{mode:'list',city:'X'}),done()]),tools,toolDefs:TOOL_DEFINITIONS})
    .handle('list',{chatSessionId:'chat-session-1',now:new Date('2026-09-20T12:00:00Z')});
  assert.equal(out.resultSetStatus.created,true);
  assert.deepEqual(out.resultSet.ticketIds,['A:1','B.2']);
  assert.equal(out.total,2);
  assert.equal(out.shown,2);
  assert.equal(out.resultItems.length,2);
});

test('distinct list filters in one turn are ambiguous and never mixed', async () => {
  let n=0;
  const tools = {query_tickets:async(args)=>({ok:true,data:{mode:'list',resolved_filters:{city:args.city},total_matched:1,tickets:[{id:++n===1?'A':'B'}]}})};
  const out = await createAskOrchestrator({groq:groq([call('query_tickets',{mode:'list',city:'X'},'c1'),call('query_tickets',{mode:'list',city:'Y'},'c2'),done()]),tools,toolDefs:TOOL_DEFINITIONS})
    .handle('two lists',{chatSessionId:'chat-session-1'});
  assert.equal(out.resultSet,null);
  assert.equal(out.resultItems.length,0);
  assert.equal(out.resultSetStatus.reason,'ambiguous_multiple_list_results');
});

test('ask-only result_index resolves exact id while public definition remains ticket_id-only', async () => {
  const active = createResultSet([{id:'A:1'},{id:'B.2'}],2,'chat-session-1',Date.parse('2026-09-20T12:00:00Z')).resultSet;
  const seen=[];
  const tools={get_ticket:async(args)=>{seen.push(args);return {ok:true,data:{found:true,ticket:{id:args.ticket_id}}};}};
  const out = await createAskOrchestrator({groq:groq([call('get_ticket',{result_index:2}),done()]),tools,toolDefs:TOOL_DEFINITIONS})
    .handle('show second',{chatSessionId:'chat-session-1',resultSet:active,now:new Date('2026-09-20T12:00:01Z')});
  assert.deepEqual(seen,[{ticket_id:'B.2'}]);
  assert.equal(out.selectedTicketId,'B.2');
  assert.deepEqual(out.presentation,{kind:'single_ticket',ticket_id:'B.2'});
  const publicDef=TOOL_DEFINITIONS.find(def=>def.name==='get_ticket');
  assert.deepEqual(publicDef.inputSchema.required,['ticket_id']);
  assert.equal(publicDef.inputSchema.properties.result_index,undefined);
});

test('open-it uses only selectedTicketId and bypasses both model and tools', async () => {
  let modelCalls=0, toolCalls=0;
  const out=await createAskOrchestrator({groq:{chat:async()=>{modelCalls++;return done();}},tools:{get_ticket:async()=>{toolCalls++;}},toolDefs:TOOL_DEFINITIONS})
    .handle('Открой её',{chatSessionId:'chat-session-1',selectedTicketId:'A:1'});
  assert.equal(modelCalls,0);
  assert.equal(toolCalls,0);
  assert.equal(out.selectedTicketId,'A:1');
  assert.deepEqual(out.presentation,{kind:'single_ticket',ticket_id:'A:1'});
  assert.equal(out.tickets.length,0);
});


/* ---------- deterministic card-open: exactly one candidate, never guessing ---------- */

const OPEN_ROW = {id:'t-open1', date:'01.09.2026', time:'10:00', city:'X', street:'Main', house:'1', address:'X, Main 1', type:'Ремонт', sum:'900'};

test('A: one referent ticket + «Открой эту заявку» opens exactly that ticket without the model', async () => {
  let modelCalls = 0;
  const out = await createAskOrchestrator({groq:{chat:async()=>{modelCalls++;return done();}}, tools:{}, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой эту заявку', {chatSessionId:'chat-session-1', contextTickets:[OPEN_ROW]});
  assert.equal(modelCalls, 0, 'no model round-trip for an unambiguous candidate');
  assert.equal(out.selectedTicketId, 't-open1');
  assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'t-open1'});
  assert.equal(out.resultSetStatus.reason, 'selected_ticket');
});

test('B: «Открой её карточку» (the original bug wording) takes the same deterministic path', async () => {
  let modelCalls = 0;
  const out = await createAskOrchestrator({groq:{chat:async()=>{modelCalls++;return done();}}, tools:{}, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой её карточку', {chatSessionId:'chat-session-1', contextTickets:[OPEN_ROW]});
  assert.equal(modelCalls, 0);
  assert.equal(out.presentation.ticket_id, 't-open1');
  assert.equal(out.selectedTicketId, 't-open1');
});

test('card-open with several or zero candidates is clarified, never guessed', async () => {
  let modelCalls = 0;
  const groqStub = {chat:async()=>{modelCalls++;return done('Уточните номер.');}};
  const many = await createAskOrchestrator({groq:groqStub, tools:{}, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой её', {chatSessionId:'chat-session-1', contextTickets:[OPEN_ROW, {id:'t-open2'}]});
  assert.equal(many.presentation, null);
  assert.equal(many.selectedTicketId, null);
  assert.equal(many.resultSetStatus.reason, 'no_selected_ticket');
  assert.equal(modelCalls, 0, 'no model guessing between several referents');
  const none = await createAskOrchestrator({groq:groqStub, tools:{}, toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи её карточку', {chatSessionId:'chat-session-1'});
  assert.equal(none.presentation, null);
  assert.equal(none.resultSetStatus.reason, 'no_selected_ticket');
});

test('a single-item active result set is an unambiguous open candidate', async () => {
  const set = createResultSet([{id:'A:1'}], 1, 'chat-session-1', Date.parse('2026-09-20T12:00:00Z')).resultSet;
  let modelCalls = 0;
  const out = await createAskOrchestrator({groq:{chat:async()=>{modelCalls++;return done();}}, tools:{}, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой её', {chatSessionId:'chat-session-1', resultSet:set, now:new Date('2026-09-20T12:00:01Z')});
  assert.equal(modelCalls, 0);
  assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'A:1'});
});

/* ---------- explicit ordinal: the structured set decides, never the model ---------- */

const NOW_ORD = Date.parse('2026-09-20T12:00:00Z');
function nineteenRows(){
  const rows = [];
  for(let i=1;i<=19;i++) rows.push({id:'t-'+String(i).padStart(2,'0'), date:'0'+(i%9+1)+'.09.2026', city:'X', street:'Main', house:String(i), address:'X, Main '+i, type:'Ремонт'});
  return rows;
}
function nineteenSet(){
  return createResultSet(nineteenRows(), 19, 'chat-session-1', NOW_ORD).resultSet;
}
function ordinalTools(seen){
  return {get_ticket:async function(args){ seen.push(args.ticket_id); return {ok:true, data:{found:true, ticket:{id:args.ticket_id}}}; }};
}

test('C: «Покажи 11-ю» opens the 11th ticket of the 19-item active set', async () => {
  const seen = [];
  const out = await createAskOrchestrator({groq:groq([done('Ось 11-а заявка.')]), tools:ordinalTools(seen), toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 11-ю', {chatSessionId:'chat-session-1', resultSet:nineteenSet(), now:new Date('2026-09-20T12:00:01Z')});
  assert.deepEqual(seen, ['t-11'], 'exactly the 11th id of the structured set was read');
  assert.equal(out.selectedTicketId, 't-11');
  assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'t-11'});
  assert.equal(out.resultSetStatus.reason, 'selected_ticket');
});

test('D: «Покажи 11-ю из этих» resolves the same 11th ticket', async () => {
  const seen = [];
  const out = await createAskOrchestrator({groq:groq([done('Ось 11-а заявка.')]), tools:ordinalTools(seen), toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 11-ю из этих', {chatSessionId:'chat-session-1', resultSet:nineteenSet(), now:new Date('2026-09-20T12:00:01Z')});
  assert.deepEqual(seen, ['t-11']);
  assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'t-11'});
});

test('E: in an ordinal turn a model-supplied ticket_id «11» cannot bypass the result set', async () => {
  const seen = [];
  const out = await createAskOrchestrator({groq:groq([call('get_ticket',{ticket_id:'11'}), done('Ось заявка.')]), tools:ordinalTools(seen), toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 11-ю', {chatSessionId:'chat-session-1', resultSet:nineteenSet(), now:new Date('2026-09-20T12:00:01Z')});
  assert.deepEqual(seen, ['t-11'], 'the guessed id «11» never reaches the read tool');
  assert.equal(out.selectedTicketId, 't-11', 'selection stays the 11th ticket of the set');
  assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'t-11'});
});

test('E2: a wrong result_index in an ordinal turn cannot override the resolved number', async () => {
  const seen = [];
  const out = await createAskOrchestrator({groq:groq([call('get_ticket',{result_index:19}), done('Ось заявка.')]), tools:ordinalTools(seen), toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 11-ю', {chatSessionId:'chat-session-1', resultSet:nineteenSet(), now:new Date('2026-09-20T12:00:01Z')});
  assert.deepEqual(seen, ['t-11']);
  assert.deepEqual(out.presentation, {kind:'single_ticket', ticket_id:'t-11'});
});

test('E3: an out-of-range number is answered honestly, without tools or model', async () => {
  const seen = [];
  let modelCalls = 0;
  const out = await createAskOrchestrator({groq:{chat:async()=>{modelCalls++;return done();}}, tools:ordinalTools(seen), toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 40-ю', {chatSessionId:'chat-session-1', resultSet:nineteenSet(), now:new Date('2026-09-20T12:00:01Z')});
  assert.equal(modelCalls, 0);
  assert.equal(seen.length, 0);
  assert.equal(out.presentation, null);
  assert.equal(out.resultSetStatus.reason, 'result_index_out_of_range');
  assert.match(out.answer, /19/);
});

test('E4: without an active list an ordinal is never turned into ticket id «11»', async () => {
  const seen = [];
  let modelCalls = 0;
  const out = await createAskOrchestrator({groq:{chat:async()=>{modelCalls++;return done('Нет активного списка.');}}, tools:ordinalTools(seen), toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 11-ю', {chatSessionId:'chat-session-1'});
  assert.equal(modelCalls, 0, 'unresolvable ordinal is answered deterministically, without the model');
  assert.equal(seen.length, 0, 'no ticket was read — «11» was not guessed as an id');
  assert.equal(out.selectedTicketId, null);
  assert.equal(out.presentation, null);
  assert.equal(out.tickets.length, 0);
  assert.equal(out.resultSet, null);
  assert.equal(out.total, 0);
});

test('E5: a number that is an address part is not treated as an ordinal', async () => {
  const seen = [];
  let modelCalls = 0;
  const out = await createAskOrchestrator({groq:{chat:async()=>{modelCalls++;return done('Уточните адрес.');}}, tools:ordinalTools(seen), toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 11-й дом на Садовій', {chatSessionId:'chat-session-1', resultSet:nineteenSet(), now:new Date('2026-09-20T12:00:01Z')});
  assert.equal(modelCalls, 1, 'address wording keeps the ordinary flow');
  assert.equal(seen.length, 0);
  assert.equal(out.resultSet, null, 'no lock, no new set');
});

/* ---------- ids that must never be rewritten ---------- */

test('F/G/H/I: dot, colon, 65–128 char ids and «12.3» ≠ «123» stay exact end-to-end', async () => {
  const ids = ['.', ':', '12.3', '123', 'x'.repeat(65), 'y'.repeat(128)];
  const set = createResultSet(ids.map(function(id){ return {id:id}; }), ids.length, 'chat-session-1', NOW_ORD).resultSet;
  assert.deepEqual(set.ticketIds, ids);
  assert.equal(sanitizeIncomingResultSet(set, 'chat-session-1', NOW_ORD).value.ticketIds.join('|'), ids.join('|'));
  const seen = [];
  const tools = {get_ticket:async function(args){ seen.push(args.ticket_id); return {ok:true, data:{found:true, ticket:{id:args.ticket_id}}}; }};
  const out = await createAskOrchestrator({groq:groq([call('get_ticket',{result_index:3}), done('Ось вона.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('відкрий третю', {chatSessionId:'chat-session-1', resultSet:set, now:new Date('2026-09-20T12:00:01Z')});
  assert.deepEqual(seen, ['12.3'], 'index 3 resolves «12.3», never «123»');
  assert.equal(out.selectedTicketId, '12.3');
});

/* ---------- deleted ticket / expired set / status truthfulness ---------- */

test('J: a ticket that no longer exists reports TICKET_NO_LONGER_AVAILABLE and shows no card', async () => {
  const gone = {get_ticket:async function(){ return {ok:true, data:{found:false}}; }};
  const out = await createAskOrchestrator({groq:groq([call('get_ticket',{ticket_id:'B.2'}), done('Заявки вже немає.')]), tools:gone, toolDefs:TOOL_DEFINITIONS})
    .handle('Открой заявку B.2', {chatSessionId:'chat-session-1'});
  assert.equal(out.presentation, null);
  assert.equal(out.selectedTicketId, null);
  assert.equal(out.resultSetStatus.reason, 'TICKET_NO_LONGER_AVAILABLE');
  /* A failed lookup produces no new ticket data, so an existing list stays
     selectable («покажи 11-ю» must keep working after a miss). */
  assert.equal(out.resultSetStatus.subjectChanged, false);
});

test('J2: an ordinal pointing at a deleted ticket keeps the list but shows no card', async () => {
  const gone = {get_ticket:async function(){ return {ok:true, data:{found:false}}; }};
  const out = await createAskOrchestrator({groq:groq([done('Заявки вже немає.')]), tools:gone, toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 2-ю', {chatSessionId:'chat-session-1', resultSet:createResultSet([{id:'A:1'},{id:'B:2'}], 2, 'chat-session-1', NOW_ORD).resultSet, now:new Date('2026-09-20T12:00:01Z')});
  assert.equal(out.presentation, null);
  assert.equal(out.resultSetStatus.reason, 'TICKET_NO_LONGER_AVAILABLE');
  assert.equal(out.resultSetStatus.subjectChanged, false, 'the list itself is still valid on the device');
});

test('K: an expired result set resolves nothing and blocks nothing', async () => {
  const expired = Object.assign({}, nineteenSet(), {createdAt:Date.parse('2026-09-19T00:00:00Z'), expiresAt:Date.parse('2026-09-19T12:00:00Z')});
  const seen = [];
  let modelCalls = 0;
  const groqStub = {chat:async()=>{modelCalls++;return done('Нет активного списка.');}};
  const out = await createAskOrchestrator({groq:groqStub, tools:ordinalTools(seen), toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 11-ю', {chatSessionId:'chat-session-1', resultSet:expired, now:new Date('2026-09-20T12:00:00Z')});
  assert.equal(seen.length, 0, 'no ordinal resolution from an expired set');
  assert.equal(out.resultSet, null, 'the dead set is not resurrected');
  assert.equal(out.presentation, null);
  /* …and the expired set does not block an ordinary question of the same shape */
  const ordinary = await createAskOrchestrator({groq:groqStub, tools:ordinalTools(seen), toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи заявки по Садовій', {chatSessionId:'chat-session-1', resultSet:expired, now:new Date('2026-09-20T12:00:00Z')});
  assert.equal(modelCalls, 1, 'the ordinary flow still runs');
  assert.equal(ordinary.resultSet, null);
});

test('status stays truthful: a created set is not reported as missing because one lookup failed', async () => {
  const tools = {
    query_tickets:async function(){ return {ok:true, data:{mode:'list', resolved_filters:{city:'X'}, total_matched:3, tickets:[{id:'A:1'},{id:'B.2'},{id:'C.3'}]}}; },
    get_ticket:async function(){ return {ok:true, data:{found:false}}; }
  };
  const out = await createAskOrchestrator({groq:groq([call('query_tickets',{mode:'list',city:'X'},'c1'), call('get_ticket',{ticket_id:'D:9'},'c2'), done('D:9 більше немає.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('список і одна стара', {chatSessionId:'chat-session-1'});
  assert.deepEqual(out.resultSet.ticketIds, ['A:1','B.2','C.3']);
  assert.equal(out.resultSetStatus.created, true, 'the set exists, so the status must not deny it');
  assert.equal(out.resultSetStatus.skippedInvalid, 0);
});

/* ---------- authoritative list, filters key, request/context contracts ---------- */

test('O: «Знайдено 19 · показано 8» comes from the authoritative list, not the model', async () => {
  const tools = {query_tickets:async function(){ return {ok:true, data:{mode:'list', resolved_filters:{city:'X'}, total_matched:19, returned:8, limit:8, tickets:nineteenRows().slice(0,8)}}; }};
  const out = await createAskOrchestrator({groq:groq([call('query_tickets',{mode:'list',city:'X',limit:8}), done('Знайдено 19 заявок, показано 8.')]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи перші вісім', {chatSessionId:'chat-session-1'});
  assert.equal(out.total, 19);
  assert.equal(out.shown, 8);
  assert.equal(out.resultItems.length, 8);
  assert.equal(out.resultSet.total, 19);
  assert.equal(out.resultSet.ticketIds.length, 8);
});

test('Q: a count in the same turn never replaces the authoritative list or its filters', async () => {
  const tools = {query_tickets:async function(args){
    if(args.mode === 'count') return {ok:true, data:{mode:'count', count:7, total_matched:7, resolved_filters:{city:'X'}}};
    return {ok:true, data:{mode:'list', resolved_filters:{city:'X'}, total_matched:2, tickets:[{id:'A:1'},{id:'B.2'}]}};
  }};
  const out = await createAskOrchestrator({groq:groq([call('query_tickets',{mode:'list',city:'X'},'c1'), call('query_tickets',{mode:'count',city:'X'},'c2'), done()]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('список та кількість', {chatSessionId:'chat-session-1'});
  assert.deepEqual(out.resultSet.ticketIds, ['A:1','B.2']);
  assert.equal(out.resultSetStatus.created, true);
  assert.equal(out.queryContext.resolved_filters.city, 'X');
  assert.equal(out.queryContext.mode, 'list');
});

test('the result set carries the structured-filters key the PWA compares', async () => {
  const tools = {query_tickets:async function(){ return {ok:true, data:{mode:'list', resolved_filters:{city:'X', house:'1'}, total_matched:1, tickets:[{id:'A:1'}]}}; }};
  const out = await createAskOrchestrator({groq:groq([call('query_tickets',{mode:'list',city:'X',house:'1'}), done()]), tools, toolDefs:TOOL_DEFINITIONS})
    .handle('list', {chatSessionId:'chat-session-1'});
  assert.equal(out.resultSet.filtersKey, out.resultSetStatus.filtersKey);
  assert.ok(out.resultSet.filtersKey.includes('X'));
  assert.equal(sanitizeIncomingResultSet(out.resultSet, 'chat-session-1', NOW_ORD).value.filtersKey, out.resultSet.filtersKey);
});

test('subjectChanged tells the PWA when a turn brings a different ticket context', async () => {
  const legacy = {search_tickets:async function(){ return {ok:true, data:{total_matched:1, tickets:[{id:'A:9'}]}}; }};
  const searched = await createAskOrchestrator({groq:groq([call('search_tickets',{query:'x'}), done()]), tools:legacy, toolDefs:TOOL_DEFINITIONS})
    .handle('Знайди x', {chatSessionId:'chat-session-1'});
  assert.equal(searched.resultSetStatus.created, false);
  assert.equal(searched.resultSetStatus.subjectChanged, true);
  assert.equal(searched.resultSetStatus.filtersKey, null);
  const chat = await createAskOrchestrator({groq:groq([done('привіт')]), tools:{}, toolDefs:TOOL_DEFINITIONS})
    .handle('привіт', {chatSessionId:'chat-session-1'});
  assert.equal(chat.resultSetStatus.subjectChanged, false, 'a ticket-free turn never invalidates the list');
});

test('E4b: an ordinal that also names an address keeps the ordinary search flow', async () => {
  let modelCalls = 0;
  const out = await createAskOrchestrator({groq:{chat:async function(){ modelCalls++; return done('Шукаю.'); }}, tools:{}, toolDefs:TOOL_DEFINITIONS})
    .handle('Покажи 11-ю заявку по Садовій', {chatSessionId:'chat-session-1'});
  assert.equal(modelCalls, 1, 'the address part is still searched');
  assert.equal(out.total, 0);
});

/* ---------- public /mcp contract + LLM-visible toolset ---------- */

test('public /mcp get_ticket schema is structurally identical to main (no result_index)', () => {
  const publicDef = TOOL_DEFINITIONS.find(function(def){ return def.name === 'get_ticket'; });
  assert.deepEqual(publicDef.inputSchema, {
    type:'object',
    additionalProperties:false,
    required:['ticket_id'],
    properties:{ticket_id:{type:'string', minLength:1, maxLength:128, description:'id заявки (рядок).'}}
  });
  assert.equal(JSON.stringify(publicDef).includes('result_index'), false);
});

test('the LLM-visible toolset stays at 11 tools with a bounded serialized payload', async () => {
  let seen = null;
  const groqStub = {chat:async function(_messages, tools){ seen = tools; return done('ok'); }};
  await createAskOrchestrator({groq:groqStub, tools:{}, toolDefs:TOOL_DEFINITIONS}).handle('привіт', {chatSessionId:'chat-session-1'});
  assert.equal(seen.length, 11);
  const size = JSON.stringify(seen).length;
  assert.ok(size < 13000, 'serialized ask tool payload must stay small, got ' + size);
  const getTicket = seen.find(function(tool){ return tool.function.name === 'get_ticket'; });
  assert.ok(getTicket.function.description.length < 300, 'get_ticket description stays short');
  assert.ok(getTicket.function.parameters.properties.result_index, 'ask-only ordinal selector stays in the /ask schema');
});
