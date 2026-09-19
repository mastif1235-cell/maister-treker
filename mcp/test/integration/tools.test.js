/* Integration tests for the 11 READ tools, incl. the proofs that they can
   only read (GET-only, allowlisted actions), are deterministic, and surface
   GAS failures honestly (no fabricated results). */

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';

import {makeApp, mockGasFetch, rpc, rpcResult, toolCall, toolData} from '../helpers/mcpapp.js';
import {FIXTURES} from '../fixtures/data.js';
import {REPO_ROOT} from '../helpers/appvm.js';
import {createReadTools, createDataPipeline} from '../../src/tools/read.js';
import {ticketFromGasRow, redactTicket} from '../../src/gas/mappers.js';

test('all 11 READ tools return data through the signed GAS reads', async () => {
  const fetchImpl = mockGasFetch('ok');
  const app = await makeApp(null, fetchImpl);

  const list = toolData((await toolCall(app, 'list_tickets', {})).result);
  assert.equal(list.total_matched, 5);
  assert.equal(list.tickets.length, 5);

  const one = toolData((await toolCall(app, 'get_ticket', {ticket_id:'t-001'})).result);
  assert.equal(one.found, true);
  assert.equal(one.ticket.id, 't-001');

  const found = toolData((await toolCall(app, 'get_ticket', {ticket_id:'no-such-id'})).result);
  assert.deepEqual(found, {found:false});

  const search = toolData((await toolCall(app, 'search_tickets', {query:'шевченка'})).result);
  assert.deepEqual(search.tickets.map(function(t){ return t.id; }).sort(), ['t-001', 't-003']);

  const places = toolData((await toolCall(app, 'list_places', {})).result);
  assert.ok(Array.isArray(places.places));
  assert.ok(places.places.length >= 1);

  const addr = toolData((await toolCall(app, 'find_tickets_by_address', {address:'вул. Шевченка 12'})).result);
  assert.ok(addr.resolved);
  assert.equal(addr.resolved.street, 'вул. Шевченка');
  assert.equal(addr.resolved.house, '12');
  assert.deepEqual(addr.tickets.map(function(t){ return t.id; }), ['t-003', 't-001']);

  const byDate = toolData((await toolCall(app, 'get_tickets_by_date', {date:'16.09.2026'})).result);
  assert.deepEqual(byDate.tickets.map(function(t){ return t.id; }), ['t-003', 't-004']);
  assert.equal(byDate.count, 2);

  const shifts = toolData((await toolCall(app, 'get_shifts', {date_from:'15.09.2026', date_to:'16.09.2026'})).result);
  assert.equal(shifts.count, 2);
  assert.equal(shifts.total_hours, 15.5);
  assert.ok(Array.isArray(shifts.by_coworker));

  const reports = toolData((await toolCall(app, 'get_reports', {date_from:'15.09.2026', date_to:'16.09.2026'})).result);
  assert.equal(reports.days.length, 2);
  assert.equal(reports.totals.count, 4);
  assert.ok(Math.abs(reports.totals.total - 2750.5) < 1e-9);

  const stats = toolData((await toolCall(app, 'get_statistics', {period:'month', anchor_date:'16.09.2026'})).result);
  assert.equal(stats.window.date_from, '01.09.2026');
  assert.equal(stats.window.date_to, '30.09.2026');
  assert.equal(stats.totals.count, 4);

  // READ-ONLY proof: every captured GAS request is a signed GET with an
  // allowlisted action.
  assert.ok(fetchImpl.calls.length >= 1);
  for(const call of fetchImpl.calls){
    assert.equal(call.method, 'GET', call.url);
    assert.ok(['list', 'getTicketById'].includes(call.action), call.url);
    assert.match(call.params.sig, /^[A-Za-z0-9_-]{43}$/);
    assert.match(call.params.nonce, /^[A-Za-z0-9_-]{16,128}$/);
    assert.match(call.params.ts, /^\d{13}$/);
  }
});

test('static proof: MCP source contains no write actions and no POST fetches', () => {
  const files = ['src/index.js','src/config.js','src/jsonrpc.js','src/ratelimit.js',
    'src/mcp/server.js','src/tools/definitions.js','src/tools/read.js','src/tools/validate.js',
    'src/gas/client.js','src/gas/mappers.js','src/gas/sync-contract.js','src/auth/bearer.js',
    'src/data/snapshot.js','src/ask/orchestrator.js','src/ask/address.js','src/ask/smart-query.js',
    'src/ask/date-resolver.js'];
  const writeActions = /addTicket|updateTicket|deleteTicket|addShift|updateShift|syncAll|deleteRowById|appendRow|setValues|postDataType|text\/plain;charset=utf-8, body:/;
  for(const rel of files){
    const source = readFileSync(path.join(REPO_ROOT, 'mcp', rel), 'utf8');
    assert.ok(!writeActions.test(source), rel + ' must not reference write actions');
    assert.ok(!/method:\s*['"]POST['"]/.test(source), rel + ' must never issue a POST');
    assert.ok(!/deleteMethod|\.post\(/.test(source), rel);
  }
});

test('list_tickets: pagination, date range, tag, type and dBm signal filters', async () => {
  const app = await makeApp();
  const page1 = toolData((await toolCall(app, 'list_tickets', {limit:2, offset:0})).result);
  assert.equal(page1.total_matched, 5);
  assert.equal(page1.returned, 2);
  /* v91.48: «найновіші першими» = семантика власного списку застосунку
     (js/data-utils.js ticketSortKey(b) - ticketSortKey(a)): у межах одного дня
     пізніший час іде першим, тому 16.09 14:00 (t-004) перед 16.09 10:30 (t-003). */
  assert.deepEqual(page1.tickets.map(function(t){ return t.id; }), ['t-004', 't-003']);

  const ranged = toolData((await toolCall(app, 'list_tickets', {date_from:'15.09.2026', date_to:'15.09.2026'})).result);
  assert.deepEqual(ranged.tickets.map(function(t){ return t.id; }).sort(), ['t-001', 't-002']);

  const byType = toolData((await toolCall(app, 'list_tickets', {type:'Ремонт'})).result);
  assert.deepEqual(byType.tickets.map(function(t){ return t.id; }), ['t-001']);

  // dBm signal filtering: -67 is worse (more negative) than -60
  const worse = toolData((await toolCall(app, 'list_tickets', {signal_worse_than:-60})).result);
  assert.ok(worse.tickets.some(function(t){ return t.id === 't-001'; })); // t-001 has signal -67

  const better = toolData((await toolCall(app, 'list_tickets', {signal_better_than:-60})).result);
  assert.ok(better.tickets.some(function(t){ return t.id === 't-003'; })); // t-003 has signal -52

  const strictRows = [{id:'strict-24', date:'01.01.2026', time:'10:00', content:'', sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify({signal:'-24'})},
    {id:'strict-25', date:'01.01.2026', time:'10:01', content:'', sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify({signal:'-25'})},
    {id:'strict-251', date:'01.01.2026', time:'10:02', content:'', sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify({signal:'-25.1'})}];
  const strictPipeline = createDataPipeline({getList:async function(){ return {ok:true, data:{tickets:strictRows, shifts:[]}}; }});
  const strictTool = createReadTools({data:strictPipeline});
  const strict = await strictTool.list_tickets({signal_worse_than:-25});
  assert.deepEqual(strict.data.tickets.map(function(t){ return t.id; }), ['strict-251']);
  const inclusive = await strictTool.list_tickets({signal_worse_or_equal:-25});
  assert.deepEqual(inclusive.data.tickets.map(function(t){ return t.id; }).sort(), ['strict-25','strict-251']);

  const tagged = toolData((await toolCall(app, 'list_tickets', {tags:['ремонт']})).result);
  assert.deepEqual(tagged.tickets.map(function(t){ return t.id; }), ['t-001']);

  const none = toolData((await toolCall(app, 'list_tickets', {tags:['немає-такого']})).result);
  assert.equal(none.total_matched, 0);
  assert.deepEqual(none.tickets, []);
});

test('historical signal filter: structured and legacy notes, precedence, no duplicates, all-time range', async () => {
  const rows = [
    {id:'structured-old', date:'18.08.2026', time:'15:07', content:'', backupNote:'', tags:[], fullDataJson:JSON.stringify({signal:'-27'})},
    {id:'legacy-old', date:'28.08.2026', time:'13:23', content:'Сигнал -27', backupNote:'', tags:[], fullDataJson:JSON.stringify({signal:''})},
    {id:'unrelated-negative', date:'01.01.2025', time:'10:00', content:'ціна -30', backupNote:'', tags:[], fullDataJson:JSON.stringify({signal:''})},
    {id:'authoritative', date:'02.02.2025', time:'10:00', content:'', backupNote:'', tags:[], fullDataJson:JSON.stringify({signal:'-23', note:'Сигнал -27'})}
  ];
  const tool = createReadTools({data:{getList:async function(){ return {ok:true, data:{tickets:rows.map(function(row){ return redactTicket(ticketFromGasRow(row)); }), shifts:[]}}; }}});
  const result = await tool.list_tickets({signal_worse_than:-25});
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.tickets.map(function(t){ return t.id; }).sort(), ['legacy-old','structured-old']);
  assert.equal(result.data.total_matched, 2);
  const allTime = await tool.list_tickets({signal_worse_than:-25, date_from:'01.01.2024', date_to:'31.12.2026'});
  assert.equal(allTime.data.total_matched, 2);
});

test('legacy alternate street is searchable through GAS row mapper and READ address tool without leaking notes', async () => {
  const row = {id:'legacy-address-1', date:'01.01.2024', time:'10:00', content:'', sum:1, tags:[], backupNote:'Приватна нотатка: Старая 44', fullDataJson:JSON.stringify({city:'Місто Тест', street:'Вул Нова', house:'44', note:'', signal:''})};
  const pipeline = createDataPipeline({getList:async function(){ return {ok:true, data:{tickets:[row], shifts:[]}}; }});
  const data = await pipeline.getList();
  assert.equal(data.data.tickets[0].street, 'Вул Нова');
  assert.equal(JSON.stringify(data.data.tickets[0]).includes('Старая'), false);
  const tool = createReadTools({data:pipeline});
  const result = await tool.find_tickets_by_address({address:'Місто Тест Старая 44'});
  assert.equal(result.data.total_matched, 1);
  assert.equal(result.data.tickets[0].id, 'legacy-address-1');
});

test('city-only address query returns all streets without ambiguity', async () => {
  const rows = ['Мостова','Берегова','Піщана'].map(function(street, i){ return {id:'city-'+i, date:'01.08.2026', time:'10:0'+i, content:'', sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Таромське', street:street, house:String(20+i)})}; });
  rows.push({id:'other-city', date:'01.08.2026', time:'12:00', content:'', sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Миколаївка 2', street:'Центральна', house:'1'})});
  const pipeline = createDataPipeline({getList:async function(){ return {ok:true, data:{tickets:rows, shifts:[]}}; }});
  const result = await createReadTools({data:pipeline}).find_tickets_by_address({address:'в Таромском'});
  assert.equal(result.data.total_matched, 3);
  assert.equal(result.data.ambiguous, false);
});

test('analytics aggregates use the complete set, not the returned page', async () => {
  const rows = Array.from({length:75}, function(_, i){ return {id:'bulk-'+i, date:'01.08.2026', time:'10:00', content:'private note '.repeat(100), sum:0, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:i%2?'Таромське':'Карнаухівка', street:'Вулиця '+(i%5), house:String(i), signal:i%2?'-26':'-20'})}; });
  const pipeline = createDataPipeline({getList:async function(){ return {ok:true, data:{tickets:rows, shifts:[]}}; }});
  const result = await createReadTools({data:pipeline}).list_tickets({signal_worse_than:-25, limit:8});
  assert.equal(result.data.total_matched, 37);
  assert.equal(result.data.returned, 8);
  assert.equal(result.data.analytics.unique_cities.find(function(x){ return x.name === 'Таромське'; }).count, 37);
  assert.equal(result.data.analytics.unique_streets.reduce(function(s,x){ return s+x.count; },0), 37);
  assert.ok(!JSON.stringify(result).includes('private note'));
});

test('list_tickets composes city, signal and date filters including legacy rows', async () => {
  const rows = [
    {id:'c1',date:'10.04.2026',time:'10:00',content:'',sum:0,tags:[],backupNote:'',fullDataJson:JSON.stringify({city:'Таромське',street:'Мостова',signal:'-27'})},
    {id:'c2',date:'10.04.2026',time:'10:01',content:'',sum:0,tags:[],backupNote:'',fullDataJson:JSON.stringify({city:'Таромське',street:'Мостова',signal:'-24'})},
    {id:'c3',date:'10.04.2026',time:'10:02',content:'',sum:0,tags:[],backupNote:'',fullDataJson:JSON.stringify({city:'Таромське',street:'Мостова',signal:'-32'})},
    {id:'c4',date:'10.04.2026',time:'10:03',content:'',sum:0,tags:[],backupNote:'',fullDataJson:JSON.stringify({city:'Карнаухівка',street:'Мостова',signal:'-30'})},
    {id:'legacy-city',date:'10.04.2026',time:'10:04',content:'Таромское ул. Пищана 16 красный LOS сигнал -31 после ремонта сигнал -24',sum:0,tags:[],backupNote:'',fullDataJson:JSON.stringify({})},
    {id:'structured-other-note-city',date:'10.04.2026',time:'10:05',content:'',sum:0,tags:[],backupNote:'Таромское в приватной заметке',fullDataJson:JSON.stringify({city:'Дніпро',street:'Центральна',signal:'-31'})}
  ];
  const pipeline = createDataPipeline({getList:async function(){return {ok:true,data:{tickets:rows,shifts:[]}};}});
  const tools = createReadTools({data:pipeline});
  const result = await tools.list_tickets({city:'Таромское',signal_worse_than:-25,date_from:'01.04.2026',date_to:'30.04.2026'});
  assert.equal(result.data.total_matched,3);
  assert.deepEqual(result.data.tickets.map(function(t){return t.id;}).sort(),['c1','c3','legacy-city'].sort());
  assert.equal(result.data.analytics.unique_cities.reduce(function(s,x){return s+x.count;},0),3);
  assert.ok(!result.data.tickets.some(function(t){return t.id === 'structured-other-note-city';}));
  for(const city of ['Таромском','Таромське']){
    const legacyOnly = await tools.list_tickets({city:city,signal_worse_than:-25,date_from:'01.04.2026',date_to:'30.04.2026'});
    assert.ok(legacyOnly.data.tickets.some(function(t){return t.id === 'legacy-city';}), city);
    assert.ok(!legacyOnly.data.tickets.some(function(t){return t.id === 'c4';}), city);
  }
});

test('pagination returns disjoint complete pages for 75 rows', async () => {
  const rows = Array.from({length:75},function(_,i){return {id:'page-'+i,date:'01.08.2026',time:'10:00',content:'',sum:0,tags:[],backupNote:'',fullDataJson:JSON.stringify({city:'Таромське',street:'Вулиця '+i,signal:'-30'})};});
  const pipeline = createDataPipeline({getList:async function(){return {ok:true,data:{tickets:rows,shifts:[]}};}});
  const tools = createReadTools({data:pipeline});
  const a = await tools.list_tickets({signal_worse_than:-25,limit:50});
  const b = await tools.list_tickets({signal_worse_than:-25,limit:50,offset:50});
  const ids = a.data.tickets.concat(b.data.tickets).map(function(t){return t.id;});
  assert.equal(a.data.total_matched,75); assert.equal(b.data.returned,25);
  assert.equal(new Set(ids).size,75);
});

test('universal search intersects equipment terms and price without leaking private notes', async () => {
  const row = {id:'router-1500',date:'28.08.2026',time:'11:59',content:'',sum:1600,tags:[],backupNote:'PRIVATE_MASTER_NOTE_SECRET',fullDataJson:JSON.stringify({city:'Таромське',street:'Футбольна',house:'39',type:'Ремонт',equipment:[{label:'Роутер',qty:1,price:1500}],presetWorks:[{label:'Пайка оптики',qty:1,price:100}]})};
  const other = {id:'router-600',date:'28.08.2026',time:'12:00',content:'',sum:700,tags:[],backupNote:'',fullDataJson:JSON.stringify({city:'Таромське',street:'Інша',house:'1',equipment:[{label:'Роутер',qty:1,price:600}]})};
  const pipeline = createDataPipeline({getList:async function(){return {ok:true,data:{tickets:[row,other],shifts:[]}};}});
  const result = await createReadTools({data:pipeline}).search_tickets({terms:['роутер','1500'],date_from:'01.08.2026',date_to:'31.08.2026'});
  assert.equal(result.data.total_matched,1); assert.equal(result.data.tickets[0].id,'router-1500');
  assert.equal(result.data.tickets[0].equipment[0].total,1500);
  const exact = await createReadTools({data:pipeline}).search_tickets({query:'Таромське',item_conditions:[{text:'роутер',unit_price:1500}]});
  assert.equal(exact.data.total_matched,1);
  const intersection = await createReadTools({data:pipeline}).search_tickets({query:'Таромське',item_conditions:[{text:'роутер',unit_price:1500},{text:'пайка',unit_price:100}]});
  assert.equal(intersection.data.total_matched,1);
  const negative = await createReadTools({data:pipeline}).search_tickets({query:'Таромське',item_conditions:[{text:'роутер',unit_price:1200}]});
  assert.equal(negative.data.total_matched,0);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_MASTER_NOTE_SECRET'));
});

test('get_shifts: coworker filtering and by_coworker aggregate', async () => {
  const app = await makeApp();
  const oleg = toolData((await toolCall(app, 'get_shifts', {coworker:'Олег'})).result);
  assert.equal(oleg.count, 2);
  assert.equal(oleg.total_hours, 15.5);
  assert.ok(oleg.by_coworker.some(function(c){ return c.coworker.includes('Олег') && c.total_hours === 15.5; }));
});

test('search_tickets: phone digits, signal and extraPhones coverage', async () => {
  const app = await makeApp();
  const byPhone = toolData((await toolCall(app, 'search_tickets', {query:'0671234567'})).result);
  assert.deepEqual(byPhone.tickets.map(function(t){ return t.id; }).sort(), ['t-001', 't-003']);

  const partial = toolData((await toolCall(app, 'search_tickets', {query:'2223344'})).result);
  assert.deepEqual(partial.tickets.map(function(t){ return t.id; }), ['t-004']);

  const bySignal = toolData((await toolCall(app, 'search_tickets', {query:'-52'})).result);
  assert.deepEqual(bySignal.tickets.map(function(t){ return t.id; }), ['t-003']);
});

test('determinism: identical data produces byte-identical outputs', async () => {
  const appA = await makeApp(null, mockGasFetch('ok'));
  const appB = await makeApp(null, mockGasFetch('ok'));
  const calls = [
    ['list_tickets', {}],
    ['search_tickets', {query:'Дніпро'}],
    ['list_places', {}],
    ['find_tickets_by_address', {address:'вул. Шевченка 12'}],
    ['get_tickets_by_date', {date:'16.09.2026'}],
    ['get_shifts', {}],
    ['get_reports', {date_from:'01.08.2026', date_to:'16.09.2026'}],
    ['get_statistics', {period:'all'}]
  ];
  for(const [name, args] of calls){
    const a = (await toolCall(appA, name, args)).text;
    const b = (await toolCall(appB, name, args)).text;
    assert.equal(a, b, name);
  }
});

test('list cache: repeated reads within TTL hit GAS once', async () => {
  const fetchImpl = mockGasFetch('ok');
  const app = await makeApp(null, fetchImpl);
  await toolCall(app, 'list_tickets', {});
  await toolCall(app, 'search_tickets', {query:'Таромське'});
  await toolCall(app, 'get_reports', {date_from:'15.09.2026', date_to:'16.09.2026'});
  const listCalls = fetchImpl.calls.filter(function(call){ return call.action === 'list'; }).length;
  assert.equal(listCalls, 1);
});

test('GAS network failure: tool reports an error result and fabricates nothing', async () => {
  const app = await makeApp(null, mockGasFetch('network'));
  for(const [name, args] of [['list_tickets',{}], ['search_tickets',{query:'Таромське'}], ['list_places',{}], ['find_tickets_by_address',{address:'вул. Шевченка'}], ['get_tickets_by_date',{date:'16.09.2026'}], ['get_shifts',{}], ['get_reports',{date_from:'15.09.2026',date_to:'16.09.2026'}], ['get_statistics',{period:'all'}]]){
    const call = await toolCall(app, name, args);
    assert.equal(call.result.isError, true, name);
    assert.match(call.text, /MCP_TOOL_ERROR: NETWORK/);
    assert.ok(!call.text.includes('"tickets"'), name + ' must not fabricate data');
    assert.ok(!call.text.includes('"found":true'));
  }
  const single = await toolCall(app, 'get_ticket', {ticket_id:'t-001'});
  assert.equal(single.result.isError, true);
  assert.match(single.text, /NETWORK/);
});

test('GAS http/protocol failures map to honest error codes', async () => {
  const http = await makeApp(null, mockGasFetch('http502'));
  assert.match((await toolCall(http, 'list_tickets', {})).text, /MCP_TOOL_ERROR: HTTP_502/);

  const badjson = await makeApp(null, mockGasFetch('badjson'));
  assert.match((await toolCall(badjson, 'list_tickets', {})).text, /MCP_TOOL_ERROR: DATA/);

  const gaserror = await makeApp(null, mockGasFetch('gaserror'));
  assert.match((await toolCall(gaserror, 'list_tickets', {})).text, /MCP_TOOL_ERROR: AUTH_FAILED/);

  const badshape = await makeApp(null, mockGasFetch('badshape'));
  assert.match((await toolCall(badshape, 'list_tickets', {})).text, /MCP_TOOL_ERROR: DATA/);

  const badTicket = await makeApp(null, mockGasFetch('badshape-ticket'));
  assert.match((await toolCall(badTicket, 'get_ticket', {ticket_id:'t-001'})).text, /MCP_TOOL_ERROR: DATA/);

  const empty = await makeApp(null, mockGasFetch('empty'));
  const emptyList = toolData((await toolCall(empty, 'list_tickets', {})).result);
  assert.deepEqual(emptyList.tickets, []);
  const missing = toolData((await toolCall(empty, 'get_ticket', {ticket_id:'t-001'})).result);
  assert.deepEqual(missing, {found:false});
});

test('invalid tool arguments return JSON-RPC -32602 and never hit GAS', async () => {
  const fetchImpl = mockGasFetch('ok');
  const app = await makeApp(null, fetchImpl);
  const before = fetchImpl.calls.length;
  const response = await rpc(app, 'tools/call', {name:'get_tickets_by_date', arguments:{date:'2026-09-16'}});
  const body = await response.json();
  assert.equal(body.error.code, -32602);
  const unknown = await (await rpc(app, 'tools/call', {name:'nope', arguments:{}})).json();
  assert.equal(unknown.error.code, -32602);
  assert.equal(fetchImpl.calls.length, before);
});
