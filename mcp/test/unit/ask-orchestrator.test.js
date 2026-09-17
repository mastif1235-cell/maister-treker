/* Unit tests for the /ask orchestrator loop (stage D). */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createAskOrchestrator, ASK_LIMITS} from '../../src/ask/orchestrator.js';
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
  assert.match(ASK_SYSTEM_PROMPT, /заявок не знайдено/, 'concrete empty-data wording');
  assert.match(ASK_SYSTEM_PROMPT, /У базі немає даних/, 'no-data wording');
  assert.match(ASK_SYSTEM_PROMPT, /Ви маєте на увазі/, 'ambiguity -> clarifying question');
  assert.match(ASK_SYSTEM_PROMPT, /2–3 конкретні варіанти/, 'ambiguity -> options');
  assert.match(ASK_SYSTEM_PROMPT, /№<id>/, 'found tickets listed as №id');
  assert.match(ASK_SYSTEM_PROMPT, /Сьогоднішня дата додана в кінці цього промпта/, 'date context referenced');
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
    {id:'123', date:'01.08.2026', content:'вул. Шевченка, 1', tags:['ремонт']},
    {id:'124', date:'02.08.2026', address:'вул. Франка, 2', type:'підключення'},
    {id:'../evil', address:'x'},
    {id:''},
    'not-an-object',
    null
  ], total_matched:2}};
  };
  const orch = createAskOrchestrator({groq, tools, toolDefs:TOOL_DEFINITIONS});
  const outcome = await orch.handle('покажи заявки');
  assert.equal(outcome.ok, true);
  assert.ok(Array.isArray(outcome.tickets), 'tickets projection returned');
  assert.equal(outcome.tickets.length, 2, 'only valid ids projected');
  assert.deepEqual(outcome.tickets[0], {id:'123', date:'01.08.2026', address:'вул. Шевченка, 1', type:'ремонт'}, 'content->address, tags->type');
  assert.equal(outcome.tickets[1].address, 'вул. Франка, 2', 'explicit address wins');
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
