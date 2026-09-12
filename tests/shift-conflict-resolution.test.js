'use strict';

// Конфлікт зміни з іншого пристрою: індикатор у списку + безпечне розв’язання
// («Залишити локальну версію» / «Прийняти версію з Таблиці») без автоматичного
// перезапису локальних даних і без втрати черги синхронізації.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../js/sync-engine-core.js');
const {Engine} = require('../js/sync-engine-runtime.js');

const ROOT = path.join(__dirname, '..');
const read = file=>fs.readFileSync(path.join(ROOT, file), 'utf8');

function storage(seed){
  let value = JSON.parse(JSON.stringify(seed || {records:{}}));
  return {load:async()=>JSON.parse(JSON.stringify(value)), save:async next=>{value = JSON.parse(JSON.stringify(next));}, value:()=>value};
}

const shift = (id, hours, coworker)=>({id, date:'05.09.2026', hours, coworker:coworker || 'Сам'});

// Стан із зафіксованим конфліктом зміни: локальна правка не пройшла, сервер має свою ревізію.
function conflictingState(localShift, serverRevision, tombstone){
  const id = String(localShift.id), requestId = 'shift_request_abcdefghijkl';
  const body = shift(localShift.id, localShift.hours, localShift.coworker);
  return {records:{[`shift:${id}`]:{
    entity:'shift', id, committedRevision:serverRevision, tombstone:false,
    head:{entity:'shift', id, action:serverRevision > 0 ? 'updateShift' : 'addShift', revision:serverRevision + 1, requestId, attempted:true, body},
    tail:null,
    conflict:{code:'CONFLICT', requestId, server:{revision:serverRevision, tombstone:!!tombstone}}
  }}};
}
const baseRecord = (id, revision)=>({entity:'shift', id, committedRevision:revision, tombstone:false, head:null, tail:null, conflict:null});

function harness(options){
  options = options || {};
  const sent = [];
  const db = storage(options.state);
  const engine = new Engine({
    core, storage:db, payload:(_entity, item)=>item, online:()=>true,
    transport:{
      send:async message=>{ sent.push(message); return {ok:true, state:{revision:message.revision, tombstone:message.action === 'deleteShift'}}; },
      getEntityState:options.getEntityState,
      listAll:options.listAll
    }
  });
  const nodes = {};
  const element = id=>nodes[id] || (nodes[id] = {innerHTML:'', textContent:'', value:'', classList:{toggle(){}, add(){}, remove(){}}, addEventListener(){}});
  const context = {
    console, Date, JSON, Array, Object, Promise, Error, String, Number, Math, Boolean, setTimeout, clearTimeout,
    shifts:[shift('s1', 8)], settings:{hourlyRate:100, coworkers:['Сам']}, statsViewDate:new Date('2026-09-01T00:00:00Z'),
    coworkerSelection:new Set(['Сам']),
    syncEngine:engine, syncShiftsSnapshot:[],
    escapeHtml:value=>String(value ?? ''), fmtMoney:value=>String(value) + ' грн',
    getShiftsForMonth:list=>list, sortShiftsByDateDesc:list=>list, calculateShiftEarnings:()=>0,
    calculateYearlyShiftHours:()=>Array.from({length:12},()=>0), calculateShiftMonthStats:()=>({count:0,totalHours:0,averageHours:0,salary:0}),
    getEntityConflict:(entity, id)=>engine.conflictFor(entity, id),
    isEntitySynced:(entity, id)=>{ const record = engine.state.records[core.key(entity, id)]; return !record || (!record.head && !record.tail); },
    shiftToSyncPayload:item=>({id:item.id, date:item.date, hours:item.hours, coworker:item.coworker}),
    saveShiftsLocalOnly:async()=>true,
    renderShiftsScreen(){ context.rendered = (context.rendered || 0) + 1; },
    showToast(message){ context.toasts.push(message); },
    openModal(title, html, opts){ context.modal = {title, html}; opts?.onOpen?.(); },
    closeModal(){ context.modal = null; },
    document:{getElementById:element},
    MTRestoreFromSheets:require('../js/restore-from-sheets.js'),
    MONTH_NAMES:['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'],
    DOW_NAMES:['Пн','Вт','Ср','Чт','Пт','Сб','Нд'],
    currentShiftDate:'05.09.2026', shiftCalendarViewDate:new Date('2026-09-01T00:00:00Z'),
    toasts:[]
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('js/shift-render.js'), context, {filename:'js/shift-render.js'});
  vm.runInContext(read('js/shifts-domain.js'), context, {filename:'js/shifts-domain.js'});
  return {context, engine, db, sent, nodes};
}

const serverState = revision=>({ok:true, result:{status:'ok', state:{revision, tombstone:false, fingerprint:'fp-' + revision}}});
const listWith = (shifts, revision)=>({ok:true, result:{status:'ok', tickets:[], shifts, states:{ticket:[], shift:[{id:shifts[0] ? shifts[0].id : 's1', revision, tombstone:false}]}}});

(async()=>{
  /* 1. індикатор конфлікту показується лише для конфліктної зміни */

  const conflicted = harness({state:conflictingState(shift('s1', 8), 3)});
  await conflicted.engine.init();
  conflicted.context.renderShiftHistory();
  const conflictHtml = conflicted.nodes.shiftHistoryCard.innerHTML;
  assert.match(conflictHtml, /shift-conflict-btn/, 'конфліктна зміна має індикатор');
  assert.match(conflictHtml, /Конфлікт/);
  assert.match(conflictHtml, /data-id="s1"/);

  const clean = harness({state:{records:{'shift:s1':baseRecord('s1', 1)}}});
  await clean.engine.init();
  clean.context.renderShiftHistory();
  assert.doesNotMatch(clean.nodes.shiftHistoryCard.innerHTML, /Конфлікт/, 'звичайна зміна не отримує конфліктний UI');

  /* 2. keep local: локальна зміна не втрачена, конфлікт знято, черга пішла далі */

  const keep = harness({state:conflictingState(shift('s1', 8), 3), getEntityState:async()=>serverState(3)});
  await keep.engine.init();
  assert.ok(keep.engine.conflictFor('shift','s1'), 'конфлікт зафіксовано журналом');
  await keep.context.keepLocalShiftConflict('s1');
  assert.equal(keep.engine.conflictFor('shift','s1'), null, 'конфлікт знято після рішення');
  assert.equal(keep.context.shifts[0].hours, 8, 'локальна версія лишилась як була');
  assert.equal(keep.sent.length, 1, 'після рішення синхронізація реально продовжилась');
  assert.equal(keep.sent[0].action, 'updateShift', 'локальна версія пішла як оновлення, а не як видалення');
  assert.equal(Number(keep.sent[0].revision), 4, 'черга продовжує з наступної серверної ревізії');
  assert.equal(keep.sent[0].body.hours, 8, 'надіслано саме локальну версію годин');
  assert.equal(core.pending(keep.engine.state).length, 0, 'черга спорожніла після відправки');
  assert.equal(keep.engine.pendingCount(), 0);
  assert.match(keep.context.toasts.join(' | '), /Локальну версію збережено ✅/);

  /* 3. accept server: беремо реальний рядок із таблиці, локальне замінюємо */

  const accept = harness({
    state:conflictingState(shift('s1', 8), 3),
    getEntityState:async()=>serverState(3),
    listAll:async()=>listWith([{id:'s1', date:'05.09.2026', hours:6, coworker:'Сергій'}], 3)
  });
  await accept.engine.init();
  await accept.context.acceptServerShiftConflict('s1');
  assert.equal(accept.context.shifts[0].hours, 6, 'локальну зміну замінено серверною');
  assert.equal(accept.context.shifts[0].coworker, 'Сергій');
  assert.equal(accept.engine.conflictFor('shift','s1'), null, 'конфлікт знято');
  assert.equal(core.pending(accept.engine.state).length, 0, 'після прийняття серверної версії черга не висить');
  assert.equal(accept.sent.length, 0, 'прийняття серверної версії не відправляє назад у таблицю');
  assert.match(accept.context.toasts.join(' | '), /Прийнято версію з Таблиці ✅/);

  /* 4. туман/tombstone: сервер видалив зміну — локальну прибираємо лише за рішенням користувача */

  const tombstoneState = {records:{}};
  tombstoneState.records['shift:s1'] = Object.assign({}, conflictingState(shift('s1', 8), 4).records['shift:s1']);
  const tombstone = harness({
    state:tombstoneState,
    getEntityState:async()=>({ok:true, result:{status:'ok', state:{revision:4, tombstone:true, fingerprint:'fp-4'}}}),
    listAll:async()=>listWith([], 4)
  });
  await tombstone.engine.init();
  await tombstone.context.acceptServerShiftConflict('s1');
  assert.equal(tombstone.context.shifts.length, 0, 'приймаючи серверну версію, локальна видалена зміна прибирається');
  assert.equal(tombstone.engine.conflictFor('shift','s1'), null);

  const keepTombstone = harness({
    state:JSON.parse(JSON.stringify(tombstoneState)),
    getEntityState:async()=>({ok:true, result:{status:'ok', state:{revision:4, tombstone:true, fingerprint:'fp-4'}}})
  });
  await keepTombstone.engine.init();
  let tombstoneError = null;
  try{ await keepTombstone.context.keepLocalShiftConflict('s1'); }catch(error){ tombstoneError = error; }
  assert.equal(tombstoneError && tombstoneError.message, 'TOMBSTONED', 'локальну версію не можна нав’язати видаленій серверній зміні');
  assert.equal(keepTombstone.context.shifts.length, 1, 'локальна зміна не зникає через невдале рішення');
  assert.ok(keepTombstone.engine.conflictFor('shift','s1'), 'конфлікт лишається, поки користувач не вирішить');

  /* 5. reload після конфлікту: стан із журналу знову дає індикатор */

  const reloadSource = harness({state:conflictingState(shift('s1', 8), 3), getEntityState:async()=>serverState(3)});
  await reloadSource.engine.init();
  const journal = JSON.parse(JSON.stringify(reloadSource.db.value()));
  const reloaded = harness({state:journal, getEntityState:async()=>serverState(3)});
  await reloaded.engine.init();
  assert.ok(reloaded.engine.conflictFor('shift','s1'), 'конфлікт переживає перезапуск');
  reloaded.context.renderShiftHistory();
  assert.match(reloaded.nodes.shiftHistoryCard.innerHTML, /Конфлікт/, 'після reload індикатор на місці');

  /* 6. заявки не регресують: їхній flow лишається на місці */

  const ticketsSource = read('js/tickets-domain.js');
  for(const owner of ['showTicketConflictResolution','acceptServerTicketConflict','keepLocalTicketConflict'])assert.ok(ticketsSource.includes(`function ${owner}`), `${owner} лишається на місці`);
  assert.match(ticketsSource, /syncEngine\.acceptServerConflict\('ticket'/, 'заявки й далі приймають серверну версію своїм шляхом');
  assert.match(ticketsSource, /syncEngine\.keepLocalConflict\('ticket'/, 'заявки й далі лишають локальну версію своїм шляхом');

  console.log('PASS shift conflict UI: badge only on real conflicts, keep-local safe, server accept through the existing list contract, tombstone and reload handled');
})().catch(error=>{console.error(error); process.exitCode = 1;});
