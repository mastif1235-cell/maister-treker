/* v91.46 regression — the REAL production smoke-test of v91.45, reproduced
   deterministically:

   Turn 1: «сколько заявок в Николаевке первый» → matched = 8
   Turn 2: «Покажи их» → production answered «11» and leaked a Миколаївка 2
           row (Дружби 8). Root cause: no structured filter carry-over — the
           follow-up re-derived filters from chat text.

   Fix: the previous turn's authoritative resolved_filters travel with the
   chat (whitelist projection) and are re-applied deterministically to a
   FRESH READ via inherit_previous_filters. Same filters, same base → same
   matched. Миколаївка 2 can never enter the follow-up of Миколаївка 1. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {createAskOrchestrator} from '../../src/ask/orchestrator.js';
import {runSmartQuery} from '../../src/ask/smart-query.js';
import {ticketFromGasRow, redactTicket} from '../../src/gas/mappers.js';
import {TOOL_DEFINITIONS} from '../../src/tools/definitions.js';

/* ---------- fixture: Миколаївка 1 (8) + Миколаївка 2 (3) ---------- */
const GAS_ROWS = [
  /* Миколаївка 1 — structured rows */
  {id:'s1', date:'03.09.2026', time:'10:00', content:'', sum:800, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Миколаївка 1', street:'Вул Садова', house:'19'})},
  {id:'s2', date:'05.09.2026', time:'10:00', content:'', sum:800, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Миколаївка 1', street:'Вул Садова', house:'3'})},
  {id:'s3', date:'08.09.2026', time:'10:00', content:'', sum:800, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Миколаївка 1', street:'Вул Центральна', house:'4'})},
  /* Миколаївка 1 — legacy rows (v91.45 mapper parity restores them) */
  {id:'l1', date:'01.09.2026', time:'10:00', content:'', sum:800, tags:[], backupNote:'ПовніДаніJSON: {"city":"Миколаївка 1","street":"Вул Генерала Пушкіна","house":"1"}', fullDataJson:''},
  {id:'l2', date:'02.09.2026', time:'10:00', content:'', sum:800, tags:[], backupNote:'ПовніДаніJSON: {"city":"Миколаївка 1","street":"Педагогічна","house":"5"}', fullDataJson:''},
  {id:'l3', date:'04.09.2026', time:'10:00', content:'', sum:800, tags:[], backupNote:'ПовніДаніJSON: {"city":"Миколаївка 1","street":"Вул Виноградна","house":"8"}', fullDataJson:''},
  {id:'l4', date:'06.09.2026', time:'10:00', content:'', sum:800, tags:[], backupNote:'ПовніДаніJSON: {"city":"Миколаївка 1","street":"Вул Криворізька","house":"3"}', fullDataJson:''},
  {id:'l5', date:'07.09.2026', time:'10:00', content:'', sum:800, tags:[], backupNote:'ПовніДаніJSON: {"city":"Миколаївка 1","street":"Пʼятихатки","house":"1"}', fullDataJson:''},
  /* Миколаївка 2 — a DIFFERENT settlement that must never leak in */
  {id:'x1', date:'27.04.2026', time:'12:00', content:'', sum:700, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Миколаївка 2', street:'Дружби', house:'8'})},
  {id:'x2', date:'28.04.2026', time:'12:00', content:'', sum:700, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Миколаївка 2', street:'Дружби', house:'10'})},
  {id:'x3', date:'29.04.2026', time:'12:00', content:'', sum:700, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Миколаївка 2', street:'Центральна', house:'2'})},
  /* strict-signal fixture rows */
  {id:'g1', date:'10.09.2026', time:'09:00', content:'', sum:500, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Таромське', signal:'-26'})},
  {id:'g2', date:'10.09.2026', time:'09:30', content:'', sum:500, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Таромське', signal:'-27'})},
  {id:'g3', date:'11.09.2026', time:'09:00', content:'', sum:500, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Таромське', signal:'-32'})},
  {id:'g4', date:'11.09.2026', time:'10:00', content:'', sum:500, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Таромське', signal:'-25'})}, /* boundary: excluded */
  /* compound fixture: ремонти в Таромському за серпень */
  {id:'r1', date:'05.08.2026', time:'11:00', content:'', sum:900, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Таромське', type:'Ремонт'})},
  {id:'r2', date:'19.08.2026', time:'11:00', content:'', sum:900, tags:[], backupNote:'', fullDataJson:JSON.stringify({city:'Таромське', type:'Ремонт'})}
];

const MAPPED = GAS_ROWS.map(ticketFromGasRow);
const REDACTED = MAPPED.map(redactTicket);
const BASE = {
  tickets: REDACTED,
  shifts: [],
  searchIndex: MAPPED.map(function(t){ return {id:t.id, text:t.searchableText}; })
};

/* The query_tickets stub mirrors mcp/src/tools/read.js: fresh READ of the
   whole base on every call, then the deterministic engine. */
function makeQueryTools(record){
  return {
    query_tickets: async function(args){
      record.push(args);
      return runSmartQuery(BASE, args);
    }
  };
}

function scriptedGroq(steps){
  let i = 0;
  return {
    seenMessages: null,
    chat: async function(messages){
      this.seenMessages = messages.map(function(m){ return {role:m.role, content:String(m.content || '')}; });
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      return step;
    }
  };
}
function toolCall(args){
  const raw = JSON.stringify(args);
  return {ok:true, content:'', toolCalls:[{id:'call_1', name:'query_tickets', argsRaw:raw}],
    assistantMessage:{role:'assistant', content:'', tool_calls:[{id:'call_1', type:'function', function:{name:'query_tickets', arguments:raw}}]}};
}
function finalAnswer(text){ return {ok:true, content:text, toolCalls:[], assistantMessage:{role:'assistant', content:text}}; }

/* ---------- turn 1 → turn 2: COUNT → «покажи их» ---------- */

test('v91.45 smoke repro: «Покажи их» inherits city=Миколаївка 1 — 8, not 11, no Миколаївка 2', async () => {
  /* Turn 1 */
  const record1 = [];
  const groq1 = scriptedGroq([
    toolCall({mode:'count', city:'Миколаївка 1'}),
    finalAnswer('У Миколаївці 1 всього 8 заявок.')
  ]);
  const orch1 = createAskOrchestrator({groq:groq1, tools:makeQueryTools(record1), toolDefs:TOOL_DEFINITIONS});
  const turn1 = await orch1.handle('Скільки заявок у Миколаївці 1?');
  assert.equal(turn1.ok, true);
  assert.equal(turn1.total, 8);
  assert.ok(turn1.queryContext, 'turn 1 must expose the structured follow-up context');
  assert.deepEqual(turn1.queryContext.resolved_filters, {city:'Миколаївка 1'});
  assert.equal(turn1.queryContext.total_matched, 8);

  /* Turn 2 — the model flags inheritance; the WORKER applies the filters */
  const record2 = [];
  const groq2 = scriptedGroq([
    toolCall({mode:'list', inherit_previous_filters:true, limit:50}),
    finalAnswer('Ось заявки:\n1. 03.09 Садова 19')
  ]);
  const orch2 = createAskOrchestrator({groq:groq2, tools:makeQueryTools(record2), toolDefs:TOOL_DEFINITIONS});
  const turn2 = await orch2.handle('Покажи их', {
    history: [
      {role:'user', content:'Скільки заявок у Миколаївці 1?'},
      {role:'assistant', content:'У Миколаївці 1 всього 8 заявок.'}
    ],
    queryContext: turn1.queryContext
  });
  assert.equal(turn2.ok, true);
  assert.equal(record2.length, 1);
  assert.equal(record2[0].city, 'Миколаївка 1', 'structured city filter inherited deterministically');
  assert.equal(record2[0].inherit_previous_filters, undefined, 'flag never reaches the query engine');
  assert.equal(turn2.total, 8, 'COUNT and LIST agree: same filters, fresh READ, same base');
  const listEnv = await runSmartQuery(BASE, record2[0]);
  for(const row of listEnv.data.tickets){
    assert.ok(!String(row.city).includes('Миколаївка 2'), 'Миколаївка 2 (Дружби 8) can never appear here');
  }
  /* the system prompt of turn 2 carries the authoritative filters */
  const system = groq2.seenMessages.find(function(m){ return m.role === 'system'; });
  assert.ok(system.content.includes('"city":"Миколаївка 1"'), 'model sees the previous structured filters');
});

/* ---------- SIGNAL follow-up: strict < -25 preserved ---------- */

test('«Скільки гірше -25?» → «Покажи их»: signal_worse_than inherited, -25 excluded, -26/-27/-32 in', async () => {
  const record1 = [];
  const groq1 = scriptedGroq([
    toolCall({mode:'count', signal_worse_than:-25}),
    finalAnswer('Заявок із сигналом гірше -25: 3.')
  ]);
  const orch1 = createAskOrchestrator({groq:groq1, tools:makeQueryTools(record1), toolDefs:TOOL_DEFINITIONS});
  const turn1 = await orch1.handle('Скільки заявок гірше -25?');
  assert.equal(turn1.total, 3);
  assert.deepEqual(turn1.queryContext.resolved_filters, {signal_worse_than:-25});

  const record2 = [];
  const groq2 = scriptedGroq([
    toolCall({mode:'list', inherit_previous_filters:true}),
    finalAnswer('Ось вони:\n1. g1\n2. g2\n3. g3')
  ]);
  const orch2 = createAskOrchestrator({groq:groq2, tools:makeQueryTools(record2), toolDefs:TOOL_DEFINITIONS});
  const turn2 = await orch2.handle('Покажи их', {queryContext: turn1.queryContext});
  assert.equal(record2[0].signal_worse_than, -25, 'strict semantics preserved');
  assert.equal(turn2.total, 3, '-25 excluded; -26/-27/-32 included');
});

/* ---------- COMPOUND follow-up: city + type + date range ---------- */

test('«Скільки ремонтів у Таромському за серпень?» → «Покажи их»: city + type + dates inherited', async () => {
  const record1 = [];
  const groq1 = scriptedGroq([
    toolCall({mode:'count', city:'Таромське', type:'Ремонт', date_from:'01.08.2026', date_to:'31.08.2026'}),
    finalAnswer('За серпень у Таромському 2 ремонти.')
  ]);
  const orch1 = createAskOrchestrator({groq:groq1, tools:makeQueryTools(record1), toolDefs:TOOL_DEFINITIONS});
  const turn1 = await orch1.handle('Скільки ремонтів у Таромському за серпень?');
  assert.equal(turn1.total, 2);

  const record2 = [];
  const groq2 = scriptedGroq([
    toolCall({mode:'list', inherit_previous_filters:true}),
    finalAnswer('Ось ремонти:\n1. 05.08\n2. 19.08')
  ]);
  const orch2 = createAskOrchestrator({groq:groq2, tools:makeQueryTools(record2), toolDefs:TOOL_DEFINITIONS});
  const turn2 = await orch2.handle('Покажи их', {queryContext: turn1.queryContext});
  assert.equal(record2[0].city, 'Таромське');
  assert.equal(record2[0].type, 'Ремонт');
  assert.equal(record2[0].date_from, '01.08.2026');
  assert.equal(record2[0].date_to, '31.08.2026');
  assert.equal(turn2.total, 2);
});

/* ---------- NO STALE FILTER: an independent question ---------- */

test('«Які вулиці в Миколаївці 1?» after a signal question does NOT inherit the old signal filter', async () => {
  const record2 = [];
  const groq2 = scriptedGroq([
    toolCall({mode:'group', group_by:'street', city:'Миколаївка 1'}),
    finalAnswer('Вулиці: Садова, Центральна…')
  ]);
  const orch2 = createAskOrchestrator({groq:groq2, tools:makeQueryTools(record2), toolDefs:TOOL_DEFINITIONS});
  await orch2.handle('Які вулиці є в Миколаївці 1?', {
    queryContext: {resolved_filters:{signal_worse_than:-25}, mode:'count', total_matched:3}
  });
  assert.equal(record2[0].signal_worse_than, undefined, 'no stale filter leaks into a new question');
  assert.equal(record2[0].city, 'Миколаївка 1');
});

test('inherit flag with NEW own filters refuses inheritance (own filters win)', async () => {
  const record2 = [];
  const groq2 = scriptedGroq([
    toolCall({mode:'count', city:'Таромське', signal_worse_than:-30, inherit_previous_filters:true}),
    finalAnswer('Одна.')
  ]);
  const orch2 = createAskOrchestrator({groq:groq2, tools:makeQueryTools(record2), toolDefs:TOOL_DEFINITIONS});
  await orch2.handle('А скільки з них гірше -30 у Таромському?', {
    queryContext: {resolved_filters:{city:'Миколаївка 1'}, mode:'count', total_matched:8}
  });
  assert.equal(record2[0].city, 'Таромське', 'new city replaces the old one');
  assert.equal(record2[0].signal_worse_than, -30);
  assert.ok(!('Миколаївка 1' === record2[0].city), 'old city must not survive');
});

/* ---------- privacy: nothing private in the carried context ---------- */

test('follow-up context injection carries no private fields', async () => {
  const groq2 = scriptedGroq([finalAnswer('Гаразд.')]);
  const orch2 = createAskOrchestrator({groq:groq2, tools:makeQueryTools([]), toolDefs:TOOL_DEFINITIONS});
  /* adversarial: client tries to smuggle private keys back */
  await orch2.handle('Покажи их', {
    queryContext: {resolved_filters:{city:'Миколаївка 1', masterNote:'СЕКРЕТНИЙ-МАРКЕР-Ж9', phone:'0679998877', clientName:'АБОНЕНТ-ПІБ-Ч5', backupNote:'ПРИВАТНА-НОТАТКА-УХ3', searchableText:'МЕРЕЖЕВИЙ-ДАМП-Х777', macAddress:'aa:bb:cc:dd:ee:ff', contractNumber:'КОНТРАКТ-9Х8'}, mode:'count', total_matched:8}
  });
  const system = groq2.seenMessages.find(function(m){ return m.role === 'system'; });
  assert.ok(system.content.includes('"city":"Миколаївка 1"'));
  for(const banned of ['СЕКРЕТНИЙ-МАРКЕР-Ж9', '0679998877', 'АБОНЕНТ-ПІБ-Ч5', 'ПРИВАТНА-НОТАТКА-УХ3', 'МЕРЕЖЕВИЙ-ДАМП-Х777', 'aa:bb:cc:dd:ee:ff', 'КОНТРАКТ-9Х8', 'masterNote', 'phone', 'clientName', 'backupNote', 'searchableText', 'macAddress', 'contractNumber']){
    assert.ok(!system.content.includes(banned), 'forbidden in system prompt: ' + banned);
  }
});
