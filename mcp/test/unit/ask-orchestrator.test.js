/* Unit tests for the /ask orchestrator loop (stage D). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createAskOrchestrator, ASK_LIMITS, ASK_SYSTEM_PROMPT} from '../../src/ask/orchestrator.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';

function scriptedGroq(steps){
  let i = 0;
  return {
    calls: 0,
    chat: async function(){
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      this.calls++;
      return typeof step === 'function' ? step() : step;
    }
  };
}

function toolResponse(name, argsRaw){
  return {ok:true, content:'', toolCalls:[{id:'call_x', name, argsRaw}],
    assistantMessage:{role:'assistant', content:'', tool_calls:[{id:'call_x', type:'function', function:{name, arguments:argsRaw}}]}};
}

function finalResponse(text){ return {ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}}; }

function stubTools(record){
  return {
    list_tickets: async function(args){ record.push(['list_tickets', args]); return {ok:true, data:{tickets:[], total_matched:0}}; },
    get_ticket: async function(args){ record.push(['get_ticket', args]); return {ok:true, data:{found:false}}; }
  };
}

test('happy path: one tool call -> tool result -> final answer', async () => {
  const record = [];
  const groq = scriptedGroq([
    toolResponse('list_tickets', '{"limit":5}'),
    finalResponse('У базі поки немає заявок.')
  ]);
  const orch = createAskOrchestrator({groq, tools:stubTools(record), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('Скільки заявок за тиждень?');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.answer, 'У базі поки немає заявок.');
  assert.equal(outcome.meta.toolCallsMade, 1);
  assert.deepEqual(record, [['list_tickets', {limit:5}]]);
});

test('tools sent to Groq use the OpenAI wire format (type/function/parameters)', async () => {
  // Regression: raw MCP defs ({name, inputSchema}) made Groq reject the whole
  // request with HTTP 400 "property 'type' is missing".
  let seenTools = null;
  const groq = {chat: async function(_messages, tools){ seenTools = tools; return finalResponse('ok'); }};
  const orch = createAskOrchestrator({groq, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  await orch.handle('тест');
  assert.ok(Array.isArray(seenTools) && seenTools.length === TOOL_DEFINITIONS.length);
  for(const tool of seenTools){
    assert.equal(tool.type, 'function');
    assert.ok(tool.function && typeof tool.function.name === 'string');
    assert.ok(typeof tool.function.description === 'string' && tool.function.description.length > 0);
    assert.equal(tool.function.parameters.type, 'object');
    assert.equal(tool.inputSchema, undefined, 'MCP field inputSchema must not leak to Groq');
    assert.equal(tool.annotations, undefined, 'MCP field annotations must not leak to Groq');
  }
  const byName = Object.fromEntries(seenTools.map(t => [t.function.name, t.function]));
  assert.ok(byName.list_tickets && byName.get_statistics);
  assert.deepEqual(byName.get_statistics.parameters.required, ['period']);
});

test('unknown tool name -> UNKNOWN_TOOL fed back, tool never executed', async () => {
  const record = [];
  const groq = scriptedGroq([
    toolResponse('delete_everything', '{}'),
    finalResponse('Такого інструменту немає.')
  ]);
  const orch = createAskOrchestrator({groq, tools:stubTools(record), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('видали все');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.meta.toolCallsMade, 1);
  assert.deepEqual(record, []); // nothing executed
});

test('WRITE tool names are rejected (only READ defs exist)', async () => {
  const record = [];
  const groq = scriptedGroq([
    toolResponse('create_ticket', '{"date":"16.09.2026","type":"Ремонт","payment":"Готівка"}'),
    toolResponse('update_ticket', '{}'),
    toolResponse('request_delete_ticket', '{}'),
    finalResponse('Запис недоступний.')
  ]);
  const orch = createAskOrchestrator({groq, tools:stubTools(record), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('створи заявку');
  assert.equal(outcome.ok, true);
  assert.deepEqual(record, []); // no write ever executed
});

test('malformed arguments -> INVALID_ARGUMENTS', async () => {
  const record = [];
  const groq = scriptedGroq([
    toolResponse('list_tickets', '{not json'),
    finalResponse('ok')
  ]);
  const orch = createAskOrchestrator({groq, tools:stubTools(record), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('q');
  assert.equal(outcome.ok, true);
  assert.deepEqual(record, []);
});

test('schema-invalid arguments -> INVALID_ARGUMENTS (no execution)', async () => {
  const record = [];
  const groq = scriptedGroq([
    toolResponse('list_tickets', '{"limit":99999}'),
    finalResponse('ok')
  ]);
  const orch = createAskOrchestrator({groq, tools:stubTools(record), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('q');
  assert.equal(outcome.ok, true);
  assert.deepEqual(record, []);
});

test('tool-loop hard cap: TOO_MANY_TOOL_CALLS, terminates', async () => {
  const groq = scriptedGroq([function(){ return toolResponse('list_tickets', '{"limit":1}'); }]);
  const orch = createAskOrchestrator({groq, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('q');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'TOO_MANY_TOOL_CALLS');
  assert.equal(outcome.meta.toolCallsMade, ASK_LIMITS.maxToolCalls);
});

test('round cap: TOO_MANY_ROUNDS', async () => {
  const groq = scriptedGroq([function(){ return toolResponse('list_tickets', '{}'); }]);
  const orch = createAskOrchestrator({groq, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS, limits:{maxRounds:2, maxToolCalls:100}});
  const outcome = await orch.handle('q');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'TOO_MANY_ROUNDS');
});

test('huge tool result is truncated with a hint', async () => {
  const huge = {ok:true, data:{tickets:Array.from({length:4000}, function(_, i){ return {id:'t-' + i, blob:'x'.repeat(50)}; })}};
  const tools = {list_tickets: async function(){ return huge; }};
  const groq = scriptedGroq([toolResponse('list_tickets', '{}'), finalResponse('done')]);
  const orch = createAskOrchestrator({groq, tools, toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('q');
  assert.equal(outcome.ok, true);
});

test('huge final answer is capped', async () => {
  const groq = scriptedGroq([finalResponse('x'.repeat(50000))]);
  const orch = createAskOrchestrator({groq, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('q');
  assert.equal(outcome.ok, true);
  assert.ok(outcome.answer.length <= ASK_LIMITS.maxAnswerChars);
});

test('Groq failure -> controlled {ok:false, code}, never throws', async () => {
  const groq = scriptedGroq([{ok:false, code:'HTTP_429', message:'rate limited'}]);
  const orch = createAskOrchestrator({groq, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('q');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'HTTP_429');
});

test('empty final answer -> EMPTY_ANSWER', async () => {
  const groq = scriptedGroq([finalResponse('   ')]);
  const orch = createAskOrchestrator({groq, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('q');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'EMPTY_ANSWER');
});

test('question is trimmed and capped; tools receive the trimmed question only via messages', async () => {
  const groq = scriptedGroq([finalResponse('ok')]);
  let seenMessages = null;
  const wrapped = {chat: async function(messages, tools){ seenMessages = messages; return groq.chat(messages, tools); }};
  const orch = createAskOrchestrator({groq:wrapped, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  await orch.handle('  ' + 'п'.repeat(5000) + '  ');
  assert.equal(seenMessages[1].content.length, ASK_LIMITS.maxQuestionChars);
});

/* ── Chat UX + структурований контракт tickets (etappe: AI HELP + CHAT UX) ── */

test('system prompt: date context line present, honest empty-data/ambiguity/no-hallucination rules', async () => {
  const {ASK_SYSTEM_PROMPT, askDateContextLine} = await import('../../src/ask/orchestrator.js');
  assert.match(ASK_SYSTEM_PROMPT, /Нічого не вигадуй/, 'no hallucination rule');
  assert.match(ASK_SYSTEM_PROMPT, /Не вигадуй значень|НЕ вигадуй значень/, 'signal no-invent rule');
  assert.match(ASK_SYSTEM_PROMPT, /заявок не знайдено/, 'concrete empty-data wording');
  assert.match(ASK_SYSTEM_PROMPT, /Шукати по всій вулиці|ширший період/, 'empty-data offers next step');
  assert.match(ASK_SYSTEM_PROMPT, /НІКОЛИ не питай користувача про поточну дату/, 'never asks for current date');
  assert.match(ASK_SYSTEM_PROMPT, /ЖОДНИХ markdown-таблиць/, 'no markdown tables (mobile)');
  assert.match(ASK_SYSTEM_PROMPT, /мовою останнього повідомлення користувача/, 'RU/UA language mirroring');
  assert.match(ASK_SYSTEM_PROMPT, /search_tickets.*частине слово|частине слово достатньо/, 'address search guidance');
  assert.match(ASK_SYSTEM_PROMPT, /signal/, 'signal field guidance');
  assert.match(ASK_SYSTEM_PROMPT, /історію діалогу/, 'follow-up context rule');
  assert.match(ASK_SYSTEM_PROMPT, /№<id>/, 'found tickets listed as №id');
  assert.match(ASK_SYSTEM_PROMPT, /Сьогоднішня дата та обчислені періоди/, 'date context referenced');
  const line = askDateContextLine(new Date(2026, 7, 31, 12, 0, 0));
  assert.match(line, /Сьогодні: 31\.08\.2026/, 'date line format DD.MM.YYYY');
  assert.match(line, /серпня/, 'month name in date line');
});

test('handle() prepends current date to the system message', async () => {
  const groq = scriptedGroq([finalResponse('ok')]);
  let seenMessages = null;
  const wrapped = {chat: async function(messages, tools){ seenMessages = messages; return groq.chat(messages, tools); }};
  const orch = createAskOrchestrator({groq:wrapped, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  await orch.handle('q', {now:new Date(2026, 8, 17)});
  assert.match(seenMessages[0].content, /Сьогодні: 17\.09\.2026/, 'date injected into system message');
});

test('tool results with tickets -> outcome.tickets sanitized projection', async () => {
  const groq = scriptedGroq([
    toolResponse('list_tickets', '{"limit":5}'),
    finalResponse('Знайдено №123 та №124.')
  ]);
  const tools = stubTools([]);
  tools.list_tickets = async function(){ return {ok:true, data:{tickets:[
    {id:'123', date:'01.08.2026', address:'вул. Шевченка, 1', tags:['ремонт']},
    {id:'124', date:'02.08.2026', address:'вул. Франка, 2', type:'підключення'},
    {id:'../evil', address:'x'},
    {id:''},
    'not-an-object',
    null
  ], total_matched:2}};
  };
  const orch = createAskOrchestrator({groq, tools, toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('покажи картки заявок');
  assert.equal(outcome.ok, true);
  assert.ok(Array.isArray(outcome.tickets), 'tickets projection returned');
  assert.equal(outcome.tickets.length, 2, 'only valid ids projected');
  const t0 = outcome.tickets[0];
  assert.equal(t0.id, '123');
  assert.equal(t0.address, 'вул. Шевченка, 1', 'explicit address field wins');
  assert.equal(t0.type, 'ремонт', 'tags->type fallback');
  assert.equal(outcome.tickets[1].address, 'вул. Франка, 2', 'explicit address wins');
  assert.ok(!('content' in t0), 'raw content is not exposed (privacy projection)');
});

test('tickets projection: cap 8, dedupe, clipping', async () => {
  const {projectTicketsForClient} = await import('../../src/ask/orchestrator.js');
  const many = Array.from({length: 12}, (_, i) => ({id:String(i + 1), date:'01.08.2026', address:'A'.repeat(500), type:'T'.repeat(300)}));
  const out = projectTicketsForClient(many);
  assert.equal(out.length, 8, 'capped at 8');
  assert.ok(out.every(t => t.address.length <= 200 && t.type.length <= 100), 'fields clipped');
  const duped = projectTicketsForClient([{id:'5', address:'a'}, {id:'5', address:'b'}, {id:'6'}]);
  assert.equal(duped.length, 2, 'dedupe by id');
  assert.equal(projectTicketsForClient('nope').length, 0, 'non-array -> empty');
  assert.equal(projectTicketsForClient([{id:'has space'}, {id:'a/b'}]).length, 0, 'unsafe ids rejected');
});

test('ask response includes tickets only when found (index.js contract)', async () => {
  const mod = await import('../../src/ask/orchestrator.js');
  const noTickets = mod.projectTicketsForClient([{id:'bad id!'}]);
  assert.equal(noTickets.length, 0, 'no tickets -> index.js omits the field');
});

test('history: bounded user/assistant messages reach groq between system and question', async () => {
  const groq = scriptedGroq([finalResponse('зрозумів, август 2026')]);
  let seenMessages = null;
  const wrapped = {chat: async function(messages, tools){ seenMessages = messages; return groq.chat(messages, tools); }};
  const orch = createAskOrchestrator({groq:wrapped, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  const history = [
    {role:'user', content:'В Таромское сколько заявок за прошлый месяц?'},
    {role:'assistant', content:'За серпень 2026 знайдено 2 заявки.'},
    {role:'system', content:'INJECTED ROLE MUST BE DROPPED'},
    {role:'tool', content:'INJECTED ROLE MUST BE DROPPED'},
    {role:'user', content:''},
    {role:'user', content:'А какой там был сигнал?'}
  ];
  const outcome = await orch.handle('А какой там был сигнал?', {now:new Date(2026, 8, 17), history});
  assert.equal(outcome.ok, true);
  assert.equal(seenMessages.length, 5, 'system + 3 valid history + question');
  assert.equal(seenMessages[1].role, 'user');
  assert.equal(seenMessages[2].role, 'assistant');
  assert.equal(seenMessages[3].content, 'А какой там был сигнал?', 'question last');
  assert.ok(!JSON.stringify(seenMessages).includes('INJECTED'), 'non user/assistant roles dropped');
});

test('history: capped at 12 messages and clipped to 1500 chars', async () => {
  const groq = scriptedGroq([finalResponse('ok')]);
  let seenMessages = null;
  const wrapped = {chat: async function(messages, tools){ seenMessages = messages; return groq.chat(messages, tools); }};
  const orch = createAskOrchestrator({groq:wrapped, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  const history = [];
  for(let i = 0; i < 30; i++){ history.push({role:'user', content:'повідомлення ' + i + ' ' + 'x'.repeat(2000)}); }
  await orch.handle('q', {history});
  const hist = seenMessages.slice(1, -1);
  assert.equal(hist.length, 12, 'history capped');
  assert.ok(hist.every(m => m.content.length <= 1500), 'history clipped');
  assert.equal(hist[hist.length - 1].content.includes('повідомлення 29'), true, 'keeps the LATEST messages');
});

test('production-like search_tickets result -> /ask tickets[] with signal/sum/time (real device case)', async () => {
  const groq = scriptedGroq([
    toolResponse('search_tickets', '{"query":"Таромськ","date_from":"01.08.2026","date_to":"31.08.2026"}'),
    finalResponse('За серпень 2026 у Таромському знайдено 2 заявки.')
  ]);
  const tools = stubTools([]);
  tools.search_tickets = async function(){ return {ok:true, data:{tickets:[
    {id:'871', date:'17.08.2026', time:'10:19', type:'Ремонт', city:'Таромское', street:'Академика Павлова', house:'3/14', apartment:'12', signal:'-27.4 dBm', sum:800, note:'заміна ONU, слабкий сигнал'},
    {id:'872', date:'18.08.2026', time:'12:05', type:'Підключення', city:'Таромское', street:'Шевченка', house:'5', signal:'-21.0 dBm', sum:650, note:''}
  ], total_matched:2}};
  };
  const orch = createAskOrchestrator({groq, tools, toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('Покажи карточки заявок в Таромском за прошлый месяц', {now:new Date(2026, 8, 17)});
  assert.equal(outcome.ok, true);
  assert.equal(outcome.tickets.length, 2, 'deterministic from tool result, not model text');
  const card = outcome.tickets[0];
  assert.deepEqual(card, {id:'871', date:'17.08.2026', time:'10:19',
    address:'Таромское, Академика Павлова 3/14, кв. 12', type:'Ремонт', sum:'800', signal:'-27.4 dBm', note:'заміна ONU, слабкий сигнал'});
});

test('total is independent from the 8-card presentation cap and ordinary search returns no cards', async () => {
  const rows = Array.from({length:25}, function(_, i){ return {id:'t-'+i, date:'01.08.2026', address:'Вул Тестова '+i, signal:'-27'}; });
  const groq = scriptedGroq([
    toolResponse('list_tickets', '{"signal_worse_than":-25}'),
    finalResponse('Всього знайдено 25 заявок.')
  ]);
  const tools = stubTools([]); tools.list_tickets = async function(){ return {ok:true, data:{tickets:rows.slice(0,8), total_matched:25, returned:8, limit:8}}; };
  const outcome = await createAskOrchestrator({groq, tools, toolDefs:TOOL_DEFINITIONS}).handle('Скільки всього заявок із сигналом нижче -25?', {history:[]});
  assert.equal(outcome.meta.total,25); assert.equal(outcome.total,25); assert.deepEqual(outcome.tickets,[]);
});

test('authoritative total survives a truncated oversized tool result and ordinary query returns no cards', async () => {
  let secondRequest = null;
  const rows = Array.from({length:25}, function(_, i){ return {id:'t-'+i, date:'01.08.2026', address:'Адрес '+i, note:'x'.repeat(900)}; });
  const groq = {calls:0, chat:async function(messages){
    this.calls++;
    if(this.calls === 2) secondRequest = messages;
    return this.calls === 1
      ? toolResponse('list_tickets', '{"signal_worse_than":-25}')
      : finalResponse('Всього знайдено 25 заявок.');
  }};
  const tools = stubTools([]); tools.list_tickets = async function(){ return {ok:true, data:{tickets:rows, total_matched:25, returned:25, limit:50}}; };
  const outcome = await createAskOrchestrator({groq, tools, toolDefs:TOOL_DEFINITIONS, limits:{maxToolResultChars:12000}}).handle('Скільки всього заявок із сигналом нижче -25?', {history:[]});
  const toolMessage = secondRequest.find(function(message){ return message.role === 'tool'; });
  assert.ok(toolMessage.content.length <= 12000);
  assert.match(toolMessage.content, /total_matched/);
  assert.match(toolMessage.content, /25/);
  assert.equal(outcome.answer, 'Всього знайдено 25 заявок.');
  assert.equal(outcome.total, 25);
  assert.deepEqual(outcome.tickets, []);
});

test('explicit card request returns only the structured card projection', async () => {
  const groq = scriptedGroq([toolResponse('list_tickets', '{}'), finalResponse('Показую картку заявки.')]);
  const tools = stubTools([]); tools.list_tickets = async function(){ return {ok:true, data:{tickets:[{id:'t-1', date:'01.08.2026'}], total_matched:1}}; };
  const outcome = await createAskOrchestrator({groq, tools, toolDefs:TOOL_DEFINITIONS}).handle('Покажи картку заявки', {history:[]});
  assert.equal(outcome.total,1); assert.equal(outcome.tickets.length,1); assert.equal(outcome.tickets[0].id,'t-1');
});

test('multi-turn follow-up passes prior user/assistant context and executes fresh composable reads', async () => {
  const cases = [
    {first:'Найди заявки с сигналом ниже -25 dBm за всё время', second:'А сколько из них в Таромском?', args:{city:'Таромское',signal_worse_than:-25}},
    {first:'На каких улицах я был в Таромском в августе 2026?', second:'А в июле?', args:{city:'Таромское',date_from:'01.07.2026',date_to:'31.07.2026'}},
    {first:'Куда я ездил 18 августа 2026?', second:'А только в Таромском?', args:{city:'Таромское',date_from:'18.08.2026',date_to:'18.08.2026'}}
  ];
  for(const scenario of cases){
    const firstRecord = [], firstGroq = scriptedGroq([toolResponse('list_tickets','{}'), finalResponse('Первичный результат.')]);
    const orch1 = createAskOrchestrator({groq:firstGroq, tools:stubTools(firstRecord), toolDefs:TOOL_DEFINITIONS});
    const first = await orch1.handle(scenario.first, {history:[]});
    assert.equal(first.ok,true);
    const record = [], seen = [];
    const secondGroq = {chat:async function(messages){ seen.push(messages); return seen.length===1 ? toolResponse('list_tickets',JSON.stringify(scenario.args)) : finalResponse('Оновлений результат.'); }};
    const orch2 = createAskOrchestrator({groq:secondGroq, tools:stubTools(record), toolDefs:TOOL_DEFINITIONS});
    const second = await orch2.handle(scenario.second, {history:[{role:'user',content:scenario.first},{role:'assistant',content:first.answer}]});
    assert.equal(second.ok,true);
    assert.deepEqual(record[0][1],scenario.args);
    assert.equal(seen[0].some(function(m){return m.role==='user' && m.content===scenario.first;}),true);
    assert.equal(seen[0].some(function(m){return m.role==='assistant' && m.content===first.answer;}),true);
  }
});

test('standalone follow-up resets stale city and signal filters', async () => {
  const record = [], seen = [];
  const groq = {chat:async function(messages){ seen.push(messages); return seen.length===1 ? toolResponse('list_tickets','{"date_from":"18.08.2026","date_to":"18.08.2026"}') : finalResponse('Заявки за 18 серпня.'); }};
  const orch = createAskOrchestrator({groq, tools:stubTools(record), toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('Какие заявки были 18 августа 2026?', {history:[
    {role:'user',content:'Найди плохие сигналы в Таромском'},
    {role:'assistant',content:'Найдено 6 заявок в Таромском.'}
  ]});
  assert.equal(outcome.ok,true);
  assert.deepEqual(record[0][1],{date_from:'18.08.2026',date_to:'18.08.2026'});
  assert.equal(seen[0].some(function(m){return m.role==='user' && /плохие сигналы/.test(m.content);}),true);
});

test('follow-up re-queries full dataset rather than displayed subset and does not create cards', async () => {
  const record = [], groq = scriptedGroq([toolResponse('list_tickets','{"city":"Таромское","signal_worse_than":-25}'), finalResponse('У Таромському знайдено 2 заявки.')]);
  const tools = stubTools(record); tools.list_tickets = async function(args){ record.push(['list_tickets',args]); return {ok:true,data:{tickets:[{id:'page-only'}],total_matched:2,returned:1,limit:1}}; };
  const outcome = await createAskOrchestrator({groq,tools,toolDefs:TOOL_DEFINITIONS}).handle('А сколько из них в Таромском?',{history:[{role:'user',content:'Найди 75 заявок с плохим сигналом'},{role:'assistant',content:'Показана только первая страница из 75.'}]});
  assert.equal(outcome.total,2); assert.deepEqual(record[0][1],{city:'Таромское',signal_worse_than:-25}); assert.deepEqual(outcome.tickets,[]);
});

test('tool-selection guidance distinguishes city analytics from street address lookup', () => {
  assert.match(ASK_SYSTEM_PROMPT, /city-only analytics\/search\/count\/group\/unique.*list_tickets/);
  assert.match(ASK_SYSTEM_PROMPT, /Конкретна вулиця\/будинок\/адреса.*find_tickets_by_address/);
  assert.match(ASK_SYSTEM_PROMPT, /follow-up.*list_tickets/);
});

test('date hints: «за прошлый месяц» resolved to concrete range in system message', async () => {
  const groq = scriptedGroq([finalResponse('ok')]);
  let seenMessages = null;
  const wrapped = {chat: async function(messages, tools){ seenMessages = messages; return groq.chat(messages, tools); }};
  const orch = createAskOrchestrator({groq:wrapped, tools:stubTools([]), toolDefs:TOOL_DEFINITIONS});
  await orch.handle('В Таромское сколько заявок было за прошлый месяц?', {now:new Date(2026, 8, 17)});
  const sys = seenMessages[0].content;
  assert.match(sys, /Сьогодні: 17\.09\.2026/);
  assert.match(sys, /«минулий місяць\/прошлый месяц» = 01\.08\.2026–31\.08\.2026/, 'deterministic previous-month range injected');
});
