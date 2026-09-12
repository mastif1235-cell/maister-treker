'use strict';

// End-to-end restore: bulk revisions from `list` must replace the per-entity
// getEntityState fan-out, while the old-server fallback, tombstone handling,
// fail-closed validation and rollback keep working.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../js/sync-engine-core.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'restore-from-sheets.js'), 'utf8');

function fakeElement(){
  return {
    textContent:'', style:{}, dataset:{},
    set onclick(fn){ if(typeof fn === 'function') fn(); },
    get onclick(){ return null; },
    set disabled(_value){}, get disabled(){ return false; },
    querySelector(){ return fakeElement(); },
    querySelectorAll(){ return []; },
    classList:{toggle(){}, add(){}, remove(){}}
  };
}

function cloudTicket(id, content){
  return {id, date:'01.09.2026', time:'10:00', content, sum:100, tags:['підключення'], backupNote:'', fullDataJson:'{}'};
}
function cloudShift(id){
  return {id, date:'01.09.2026', hours:8, coworker:'Сам'};
}

function buildContext(options){
  options = options || {};
  const cloudTickets = options.tickets || [cloudTicket('t1', 'one')];
  const cloudShifts = options.shifts || [cloudShift('s1')];
  const ctx = {
    console, TextEncoder, TextDecoder,
    window:{},
    MTSyncEngineCore:core,
    blankTicketObject:()=>({}),
    parseBackupNote:()=>({geoLink:'',masterNote:'',login:'',password:'',fullData:null}),
    ticketToSyncPayload:t=>({id:String(t.id||''),date:String(t.date||''),time:String(t.time||''),content:String(t.content||''),sum:Number(t.sum)||0,tags:t.tags||[],backupNote:'',fullDataJson:String(t.fullDataJson||'')}),
    tickets:[], shifts:[],
    syncTicketsSnapshot:[], syncShiftsSnapshot:[],
    ticketWrites:0, shiftWrites:0, syncTickets:0, syncShifts:0,
    backupWrites:0, listCalls:0, stateCalls:[], seeded:[], toasts:[], modals:[],
    saveTicketsLocalOnly:async()=>{ctx.ticketWrites++;return true;},
    saveShiftsLocalOnly:async()=>{ctx.shiftWrites++;return !options.failShiftWrite;},
    saveTickets:async()=>{ctx.syncTickets++;}, saveShifts:async()=>{ctx.syncShifts++;},
    backupDb:{}, backupDbPut:async()=>{ctx.backupWrites++;return true;},
    backupDbGet:async()=>null, backupDbDelete:async()=>true,
    loadDailyBackupIndex:()=>[], saveDailyBackupIndex:()=>{}, DAILY_BACKUP_MAX:10,
    toolsExportData:()=>({diagnostics:[],networkPoints:[]}),
    mtBackupSafeExport:value=>value,
    securitySanitizeSettingsForBackup:value=>value,
    settings:{syncHmacSecret:'x'.repeat(40)},
    renderTicketsScreen(){}, renderShiftsScreen(){}, renderSettingsScreen(){}, renderDailyBackupList(){},
    openModal(title, _body, opts){ ctx.modals.push(String(title)); if(opts && typeof opts.onOpen === 'function') opts.onOpen(fakeElement()); },
    closeModal(){},
    openConfirmModal:async()=>true,
    showToast:message=>ctx.toasts.push(String(message)),
    escapeHtml:value=>String(value),
    navigator:{onLine:true},
    MTSafeError:{reportError(error){ ctx.reportedErrors = (ctx.reportedErrors || []).concat([error && error.code || 'ERROR']); }},
    getScriptUrl:()=> 'https://example/exec',
    __cloud:{tickets:cloudTickets, shifts:cloudShifts, statesJson:options.states === undefined ? undefined : JSON.stringify(options.states)}
  };
  const serverRevisions = options.serverRevisions || {};
  const serverTombstones = options.serverTombstones || {};
  ctx.syncEngine = {
    state:{records:{}},
    transport:{
      listAll:async()=>{
        ctx.listCalls++;
        const result = {status:'ok', tickets:ctx.__cloud.tickets, shifts:ctx.__cloud.shifts};
        // Parse inside the sandbox realm so the client sees its own plain objects.
        if(ctx.__cloud.statesJson !== undefined) result.states = ctx.__parseJsonInRealm(ctx.__cloud.statesJson);
        return {ok:true, result};
      },
      getEntityState:async(entity, id)=>{
        ctx.stateCalls.push(`${entity}:${id}`);
        if(options.failFallbackId && id === options.failFallbackId) return {ok:false, result:{status:'error', code:'NETWORK'}};
        return {ok:true, result:{status:'ok', state:{revision:Number(serverRevisions[id]) || 0, tombstone:!!serverTombstones[id]}}};
      }
    },
    pendingCount:()=>0,
    seedBaseline:async(entity, id, server)=>{
      ctx.seeded.push({entity, id, revision:Number(server.revision) || 0, tombstone:!!server.tombstone});
      if(options.cheapSeed) return;
      ctx.syncEngine.state = core.seedBaseline(ctx.syncEngine.state, entity, id, server);
    },
    replaceState:async(state)=>{ ctx.replaceCount = (ctx.replaceCount || 0) + 1; ctx.syncEngine.state = JSON.parse(JSON.stringify(state || {records:{}})); }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('globalThis.__parseJsonInRealm = function(text){ return JSON.parse(text); };', ctx);
  vm.runInContext(source, ctx, {filename:'restore-from-sheets.js'});
  return ctx;
}

function commitRevision(ctx, id){
  const record = ctx.syncEngine.state.records[`ticket:${id}`];
  return record ? record.committedRevision : null;
}

(async()=>{
  // 1. New server + new client: revisions come from `list`, zero getEntityState.
  let ctx = buildContext({
    tickets:[cloudTicket('t1','one'), cloudTicket('t2','two'), cloudTicket('t3','three')],
    shifts:[cloudShift('s1')],
    states:{ticket:[{id:'t1',revision:7,tombstone:false},{id:'t2',revision:0,tombstone:false}], shift:[{id:'s1',revision:4,tombstone:false}]}
  });
  await ctx.restoreFromGoogleSheets('both');
  assert.equal(ctx.listCalls, 1, 'exactly one list call');
  assert.equal(ctx.stateCalls.length, 0, 'bulk states replace every getEntityState call');
  assert.deepEqual(ctx.seeded.map(entry=>[entry.id, entry.revision]), [['t1',7],['t2',0],['t3',0],['s1',4]], 'revisions seeded from list, missing state row means revision 0');
  assert.equal(commitRevision(ctx, 't1'), 7);
  assert.equal(commitRevision(ctx, 't2'), 0, 'revision 0 stays 0');
  assert.equal(ctx.tickets.length, 3);
  assert.equal(ctx.shifts.length, 1);
  assert.equal(ctx.syncTickets + ctx.syncShifts, 0, 'restore never enqueues a Google mutation');
  assert.equal(ctx.backupWrites, 1, 'pre-restore backup still created');

  // 2. Tombstone in bulk states: never imported, never seeded as baseline.
  ctx = buildContext({
    tickets:[cloudTicket('t1','one'), cloudTicket('gone','deleted')],
    shifts:[],
    states:{ticket:[{id:'t1',revision:2,tombstone:false},{id:'gone',revision:9,tombstone:true}], shift:[]}
  });
  await ctx.restoreFromGoogleSheets('tickets');
  assert.equal(ctx.stateCalls.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.tickets.map(t=>t.id))), ['t1'], 'tombstoned cloud row is not imported');
  assert.equal(ctx.seeded.some(entry=>entry.id === 'gone'), false, 'tombstone never seeded as a baseline');
  assert.equal(commitRevision(ctx, 'gone'), null);

  // 3. Old server without states: previous per-entity fallback still works.
  ctx = buildContext({
    tickets:[cloudTicket('t1','one'), cloudTicket('t2','two')],
    shifts:[cloudShift('s1')],
    serverRevisions:{t1:7, t2:0, s1:4}
  });
  await ctx.restoreFromGoogleSheets('both');
  assert.equal(ctx.listCalls, 1);
  assert.deepEqual(ctx.stateCalls.slice().sort(), ['shift:s1','ticket:t1','ticket:t2'], 'fallback fetches every baseline candidate');
  const seededRevisions = ctx.seeded.map(entry=>[entry.id, entry.revision]).sort((a, b)=>(a[0] < b[0] ? -1 : 1));
  assert.deepEqual(seededRevisions, [['s1',4],['t1',7],['t2',0]], 'fallback seeds the same baseline shape');
  assert.equal(commitRevision(ctx, 't1'), 7);
  assert.equal(ctx.backupWrites, 1);

  // 3b. Fallback tombstone keeps skipCloud semantics.
  ctx = buildContext({
    tickets:[cloudTicket('t1','one'), cloudTicket('gone','deleted')],
    shifts:[],
    serverRevisions:{t1:2, gone:9},
    serverTombstones:{gone:true}
  });
  await ctx.restoreFromGoogleSheets('tickets');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.tickets.map(t=>t.id))), ['t1'], 'fallback still skips tombstoned rows');
  assert.equal(ctx.seeded.some(entry=>entry.id === 'gone'), false);

  // 4. Damaged states fail closed: no restore, no writes, no extra requests.
  for(const states of [
    {ticket:[{id:'t1',revision:'7',tombstone:false}], shift:[]},
    {ticket:[{id:'t1',revision:1,tombstone:false},{id:'t1',revision:2,tombstone:false}], shift:[]},
    {ticket:[]}
  ]){
    ctx = buildContext({tickets:[cloudTicket('t1','one')], shifts:[], states});
    await ctx.restoreFromGoogleSheets('tickets');
    assert.equal(ctx.stateCalls.length, 0, 'damaged states never fall back to per-entity requests');
    assert.equal(ctx.ticketWrites, 0, 'damaged states change nothing on disk');
    assert.equal(ctx.seeded.length, 0, 'damaged states seed nothing');
    assert.ok(ctx.toasts.some(message=>message.indexOf('пошкоджену відповідь') >= 0), 'damaged states are reported as malformed');
  }

  // 5. Unsafe keys are rejected outright.
  ctx = buildContext({
    tickets:[cloudTicket('t1','one')], shifts:[],
    states:JSON.parse('{"ticket":[{"id":"t1","revision":1,"tombstone":false,"__proto__":{"polluted":true}}],"shift":[]}')
  });
  await ctx.restoreFromGoogleSheets('tickets');
  assert.equal(ctx.stateCalls.length, 0);
  assert.equal(ctx.ticketWrites, 0);
  assert.ok(ctx.toasts.some(message=>message.indexOf('пошкоджену відповідь') >= 0), 'unsafe states keys rejected');

  // 6. Rollback keeps working with the bulk-states path.
  ctx = buildContext({
    tickets:[cloudTicket('t1','one')],
    shifts:[cloudShift('s1')],
    states:{ticket:[{id:'t1',revision:5,tombstone:false}], shift:[{id:'s1',revision:6,tombstone:false}]},
    failShiftWrite:true
  });
  const journalBefore = JSON.stringify(ctx.syncEngine.state);
  await ctx.restoreFromGoogleSheets('both');
  assert.equal(ctx.stateCalls.length, 0, 'rollback case still avoids per-entity requests');
  assert.equal(ctx.replaceCount, 1, 'journal rolled back');
  assert.equal(JSON.stringify(ctx.syncEngine.state), journalBefore, 'journal restored to the pre-restore value');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.tickets)), [], 'tickets rolled back in memory');
  assert.ok(ctx.toasts.some(message=>message.indexOf('Відновлення не вдалося') >= 0) || ctx.modals.some(title=>title.indexOf('не вдалося') >= 0), 'failure is reported to the user');

  // 7. Request counts for 100 / 1000 / 5000 records.
  for(const size of [100, 1000, 5000]){
    const tickets = [];
    const states = [];
    for(let i = 0; i < size; i++){
      tickets.push(cloudTicket('t' + i, 'c' + i));
      states.push({id:'t' + i, revision:(i % 5) + 1, tombstone:false});
    }
    ctx = buildContext({tickets, shifts:[], states:{ticket:states, shift:[]}, cheapSeed:true});
    await ctx.restoreFromGoogleSheets('tickets');
    assert.equal(ctx.listCalls + ctx.stateCalls.length, 1, `${size} records: new server = 1 request total`);
    assert.equal(ctx.seeded.length, size, `${size} records seeded without a single extra request`);

    ctx = buildContext({tickets, shifts:[], serverRevisions:{}, cheapSeed:true});
    await ctx.restoreFromGoogleSheets('tickets');
    assert.equal(ctx.listCalls + ctx.stateCalls.length, 1 + size, `${size} records: old server = 1 + N requests`);
  }

  // 8. Fallback failure still aborts before any local change (unchanged safety).
  ctx = buildContext({
    tickets:[cloudTicket('t1','one'), cloudTicket('t2','two')],
    shifts:[],
    failFallbackId:'t2'
  });
  await ctx.restoreFromGoogleSheets('tickets');
  assert.ok(ctx.stateCalls.indexOf('ticket:t1') >= 0 && ctx.stateCalls.indexOf('ticket:t2') >= 0, 'fallback attempted both entities');
  assert.equal(ctx.ticketWrites, 0, 'failed fallback leaves the local base untouched');
  assert.equal(ctx.seeded.length, 0);

  console.log('PASS restore uses bulk list states, keeps fallback, tombstones, fail-closed states and rollback');
})().catch(error=>{ console.error(error); process.exitCode = 1; });
