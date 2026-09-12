'use strict';

// R1/R2: після відновлення з Google Sheets baseline кожного запису, який є в
// хмарі (new/match/conflict), має дорівнювати серверній ревізії, а локальний
// запис, видалений у хмарі (tombstone), лишається локально з вирівняним
// baseline і без retry-циклу.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../js/sync-engine-core.js');
const { Engine } = require('../js/sync-engine-runtime.js');
const restore = require('../js/restore-from-sheets.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'restore-from-sheets.js'), 'utf8');

// Як у застосунку: fullDataJson будується зі структурних полів заявки, тому
// порівняння хмари й локалі враховує адресу, а не лише пласкі поля.
const ticketToSyncPayload = t=>({
  id:String(t.id||''), date:String(t.date||''), time:String(t.time||''), content:String(t.content||''),
  sum:Number(t.sum)||0, tags:Array.isArray(t.tags)?t.tags:[], backupNote:'',
  fullDataJson:JSON.stringify({city:String(t.city||''), address:String(t.address||'')})
});
const ticketDeps = {
  blankTicketObject:()=>({}),
  parseBackupNote:()=>({geoLink:'',masterNote:'',login:'',password:'',fullData:null}),
  ticketToSyncPayload
};
const localTicketRow = (id,content) => ({id,date:'01.09.2026',time:'10:00',content,sum:100,tags:['підключення'],backupNote:'',city:'Київ',address:'Хрещатик 1'});
const cloudTicketRow = (id,content) => ({id,date:'01.09.2026',time:'10:00',content,sum:100,tags:['підключення'],backupNote:'',fullDataJson:JSON.stringify({city:'Київ',address:'Хрещатик 1'})});

/* ---------- 1. Чистий модуль: набір baseline і R2-помічник ---------- */

const matchPlan = restore.buildTicketPlan([localTicketRow('t1','x')],[cloudTicketRow('t1','x')],ticketDeps);
assert.equal(matchPlan.stats.matchCount,1,'identical row is a match');
assert.deepEqual(restore.baselineRequests(matchPlan),[{entity:'ticket',id:'t1'}],'R1: match still aligns the server revision');

const localPlan = restore.buildTicketPlan([localTicketRow('c1','local')],[cloudTicketRow('c1','cloud')],ticketDeps);
assert.equal(localPlan.stats.conflictCount,1,'different row is a conflict');
assert.deepEqual(restore.baselineRequests(localPlan),[{entity:'ticket',id:'c1'}],'R1: conflict → local aligns the server revision too');
assert.equal(restore.applyTicketPlan([localTicketRow('c1','local')],[cloudTicketRow('c1','cloud')],{c1:'local'},ticketDeps)[0].content,'local','local decision keeps local content');
assert.equal(restore.applyTicketPlan([localTicketRow('c1','local')],[cloudTicketRow('c1','cloud')],{c1:'cloud'},ticketDeps)[0].content,'cloud','cloud decision still imports cloud content');
assert.equal(restore.applyTicketPlan([localTicketRow('only','local')],[],[],ticketDeps)[0].id,'only','local-only row is never deleted');

const statesMap = {
  ticket:new Map([['z1',{revision:9,tombstone:true}],['alive',{revision:4,tombstone:false}]]),
  shift:new Map([['sz1',{revision:2,tombstone:true}]])
};
assert.deepEqual(
  restore.tombstonedLocalBaselines([{entity:'ticket',id:'alive'}],statesMap),
  {baselines:[]},
  'R2: live server state is not treated as deleted'
);
assert.deepEqual(
  restore.tombstonedLocalBaselines([{entity:'ticket',id:'z1'},{entity:'shift',id:'sz1'}],statesMap),
  {baselines:[{entity:'ticket',id:'z1',revision:9,tombstone:false},{entity:'shift',id:'sz1',revision:2,tombstone:false}]},
  'R2: tombstoned local record aligns the server revision without the tombstone flag'
);
assert.equal(restore.tombstonedLocalBaselines([{entity:'ticket',id:'z1'},{entity:'ticket',id:'z1'}],statesMap).baselines.length,1,'duplicate ids are seeded once');

/* ---------- 2. Двигун: правка після restore синхронізується без STALE ---------- */

function storageDouble(seed){
  let value = JSON.parse(JSON.stringify(seed || {records:{}}));
  let saves = 0;
  return {
    load:async()=>JSON.parse(JSON.stringify(value)),
    save:async next=>{saves++;value=JSON.parse(JSON.stringify(next));},
    value:()=>value,
    saves:()=>saves
  };
}

// Ті самі гейти, що в Code.gs: STALE читабельний як ok, TOMBSTONED — як відмова.
function codeGsGate(server){
  return function gate(mutation){
    const bucket = server[mutation.entity] || (server[mutation.entity] = {});
    const current = bucket[mutation.id] || {revision:0,tombstone:false,fingerprint:'',body:null};
    const state = {revision:current.revision,tombstone:current.tombstone};
    if(mutation.revision < current.revision) return {ok:true,outcome:'STALE',state};
    if(mutation.revision === current.revision){
      if(current.fingerprint === mutation.requestId) return {ok:true,outcome:'IDEMPOTENT_SUCCESS',state};
      return {ok:false,result:{status:'error',code:'CONFLICT',state}};
    }
    if(mutation.revision !== current.revision + 1) return {ok:false,result:{status:'error',code:'REVISION_GAP',state}};
    const deleting = mutation.action === 'deleteTicket' || mutation.action === 'deleteShift';
    if(current.tombstone && !deleting) return {ok:false,result:{status:'error',code:'TOMBSTONED',state:{revision:current.revision,tombstone:true}}};
    bucket[mutation.id] = {revision:mutation.revision,tombstone:deleting,fingerprint:mutation.requestId,body:mutation.body};
    return {ok:true,outcome:'APPLIED',state:{revision:mutation.revision,tombstone:deleting}};
  };
}

async function verifyEngineAlignment(){
  // 2a. Доказ причини R1: старий (невирівняний) baseline гине мовчки в STALE.
  const staleServer = {ticket:{t1:{revision:5,tombstone:false,fingerprint:'server'}}};
  const staleOutcomes = [];
  const staleEngine = new Engine({
    core,
    storage:storageDouble(core.seedBaseline({records:{}},'ticket','t1',{revision:3,tombstone:false})),
    payload:(_entity,item)=>item,
    online:()=>true,
    transport:{send:async mutation=>{const result = codeGsGate(staleServer)(mutation); staleOutcomes.push(result.outcome || result.result.code); return result;}}
  });
  await staleEngine.init();
  await staleEngine.recordDiff('ticket',[{id:'t1',content:'old'}],[{id:'t1',content:'new'}]);
  await staleEngine.loop;
  assert.deepEqual(staleOutcomes,['STALE'],'stale baseline is answered with STALE');
  assert.equal(staleServer.ticket.t1.revision,5,'server never applied the stale mutation');
  assert.equal(staleEngine.pendingCount(),0,'stale response is acknowledged, the edit never reached Sheets');

  // 2b. R1 після фіксу: baseline = серверна ревізія → наступна правка APPLIED.
  const alignedServer = {ticket:{t1:{revision:5,tombstone:false,fingerprint:'server'}}};
  const alignedCalls = [];
  const alignedEngine = new Engine({
    core,
    storage:storageDouble(core.seedBaseline({records:{}},'ticket','t1',{revision:5,tombstone:false})),
    payload:(_entity,item)=>item,
    online:()=>true,
    transport:{send:async mutation=>{const result = codeGsGate(alignedServer)(mutation); alignedCalls.push({outcome:result.outcome || result.result.code,action:mutation.action,revision:mutation.revision}); return result;}}
  });
  await alignedEngine.init();
  await alignedEngine.recordDiff('ticket',[{id:'t1',content:'old'}],[{id:'t1',content:'new'}]);
  await alignedEngine.loop;
  assert.deepEqual(alignedCalls,[{outcome:'APPLIED',action:'updateTicket',revision:6}],'aligned baseline sends revision+1 and is applied');
  assert.equal(alignedServer.ticket.t1.body.content,'new','cloud received the local edit');
  assert.equal(alignedEngine.pendingCount(),0,'aligned edit is fully synced');

  // 2c. Конфлікт → local: контент лишається локальним, ревізія серверна.
  const conflictServer = {ticket:{c1:{revision:6,tombstone:false,fingerprint:'server'}}};
  const conflictEngine = new Engine({
    core,
    storage:storageDouble(core.seedBaseline({records:{}},'ticket','c1',{revision:6,tombstone:false})),
    payload:(_entity,item)=>item,
    online:()=>true,
    transport:{send:async mutation=>codeGsGate(conflictServer)(mutation)}
  });
  await conflictEngine.init();
  await conflictEngine.recordDiff('ticket',[{id:'c1',content:'local-old'}],[{id:'c1',content:'local-new'}]);
  await conflictEngine.loop;
  assert.equal(conflictServer.ticket.c1.revision,7,'local conflict decision still reaches the next revision');
  assert.equal(conflictServer.ticket.c1.body.content,'local-new','local content is what gets synced');
  assert.equal(conflictEngine.pendingCount(),0);

  // 2d. R2: локальний запис, видалений у хмарі — одна відмова, паркінг, без retry.
  const zombieServer = {ticket:{z1:{revision:9,tombstone:true,fingerprint:'deleted'}}};
  const zombieSends = [];
  const zombieTimers = [];
  const zombieStorage = storageDouble(core.seedBaseline({records:{}},'ticket','z1',{revision:9,tombstone:false}));
  const zombieEngine = new Engine({
    core,
    storage:zombieStorage,
    payload:(_entity,item)=>item,
    online:()=>true,
    setTimeout:(fn,delay)=>{zombieTimers.push(delay);return zombieTimers.length;},
    clearTimeout:()=>{},
    transport:{send:async mutation=>{zombieSends.push({action:mutation.action,revision:mutation.revision}); return codeGsGate(zombieServer)(mutation);}}
  });
  await zombieEngine.init();
  assert.equal(zombieStorage.value().records['ticket:z1'].tombstone,false,'restored local record is not locked as deleted');
  await zombieEngine.recordDiff('ticket',[{id:'z1',content:'keep'}],[{id:'z1',content:'keep-edited'}]);
  await zombieEngine.loop;
  assert.deepEqual(zombieSends,[{action:'updateTicket',revision:10}],'tombstoned id is refused exactly once');
  assert.equal(zombieTimers.length,0,'permanent refusal is parked without a retry timer');
  assert.equal(zombieEngine.conflictFor('ticket','z1').code,'CONFLICT','tombstone refusal waits as an explicit conflict');
  assert.equal(zombieEngine.pendingCount(),1,'parked conflict waits for the user, not for retries');
  assert.equal(zombieServer.ticket.z1.revision,9,'no automatic re-creation happened');
  await zombieEngine.acceptServerConflict('ticket','z1',{revision:9,tombstone:true});
  assert.equal(zombieEngine.pendingCount(),0,'explicit server choice resolves the parked deletion');
  assert.equal(zombieEngine.state.records['ticket:z1'].tombstone,true,'delete-wins is recorded after the explicit user action');

  // 2e. Пакетний seed: один журнальний запис на весь набір baseline.
  const bulkItems = [];
  for(let i = 0; i < 5000; i++) bulkItems.push({entity:'ticket',id:'t' + i,revision:(i % 5) + 1,tombstone:false});
  const bulkStorage = storageDouble({records:{}});
  const bulkEngine = new Engine({core,storage:bulkStorage,payload:(_entity,item)=>item,online:()=>false,transport:{send:async()=>({ok:true})}});
  await bulkEngine.init();
  await bulkEngine.seedBaselines(bulkItems);
  assert.equal(bulkStorage.saves(),1,'5000 baselines are persisted in a single journal transition');
  assert.equal(bulkStorage.value().records['ticket:t4999'].committedRevision,5,'bulk seeding writes the aligned revision');
}

/* ---------- 3. Повний restore-рантайм: match, conflict → local, tombstone ---------- */

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

function buildContext(options){
  options = options || {};
  const ctx = {
    console, TextEncoder, TextDecoder,
    window:{},
    MTSyncEngineCore:core,
    blankTicketObject:()=>({}),
    parseBackupNote:()=>({geoLink:'',masterNote:'',login:'',password:'',fullData:null}),
    ticketToSyncPayload,
    tickets:JSON.parse(JSON.stringify(options.tickets || [])),
    shifts:[],
    syncTicketsSnapshot:[], syncShiftsSnapshot:[],
    ticketWrites:0, shiftWrites:0, seeded:[], modals:[],
    saveTicketsLocalOnly:async()=>{ctx.ticketWrites++;return true;},
    saveShiftsLocalOnly:async()=>{ctx.shiftWrites++;return true;},
    backupDb:{}, backupDbPut:async()=>true, backupDbGet:async()=>null, backupDbDelete:async()=>true,
    loadDailyBackupIndex:()=>[], saveDailyBackupIndex:()=>{}, DAILY_BACKUP_MAX:10,
    toolsExportData:()=>({diagnostics:[],networkPoints:[]}),
    mtBackupSafeExport:value=>value,
    securitySanitizeSettingsForBackup:value=>value,
    settings:{syncHmacSecret:'x'.repeat(40)},
    renderTicketsScreen(){}, renderShiftsScreen(){}, renderSettingsScreen(){}, renderDailyBackupList(){},
    openModal(title,body,opts){ ctx.modals.push({title:String(title), body:String(body)}); if(opts && typeof opts.onOpen === 'function') opts.onOpen(fakeElement()); },
    closeModal(){},
    openConfirmModal:async()=>true,
    showToast(){},
    escapeHtml:value=>String(value),
    navigator:{onLine:true},
    MTSafeError:{reportError(){}},
    getScriptUrl:()=> 'https://example/exec',
    __cloud:{tickets:options.cloudTickets || [], statesJson:options.states === undefined ? undefined : JSON.stringify(options.states)}
  };
  ctx.syncEngine = {
    state:{records:{}},
    transport:{
      listAll:async()=>{
        const result = {status:'ok', tickets:ctx.__cloud.tickets, shifts:[]};
        if(ctx.__cloud.statesJson !== undefined) result.states = ctx.__parseJsonInRealm(ctx.__cloud.statesJson);
        return {ok:true, result};
      }
    },
    pendingCount:()=>0,
    seedBaseline:async(entity,id,server)=>{
      ctx.seeded.push({entity, id, revision:Number(server.revision) || 0, tombstone:!!server.tombstone});
      ctx.syncEngine.state = core.seedBaseline(ctx.syncEngine.state, entity, id, server);
    },
    seedBaselines:async(items)=>{
      (Array.isArray(items) ? items : []).forEach(item=>ctx.seeded.push({entity:item.entity, id:item.id, revision:Number(item.revision) || 0, tombstone:!!item.tombstone}));
      ctx.syncEngine.state = (Array.isArray(items) ? items : []).reduce((state,item)=>core.seedBaseline(state, item.entity, item.id, {revision:item.revision, tombstone:!!item.tombstone}), ctx.syncEngine.state);
    },
    replaceState:async state=>{ ctx.syncEngine.state = JSON.parse(JSON.stringify(state || {records:{}})); }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('globalThis.__parseJsonInRealm = function(text){ return JSON.parse(text); };', ctx);
  vm.runInContext(source, ctx, {filename:'restore-from-sheets.js'});
  return ctx;
}

(async()=>{
  await verifyEngineAlignment();

  // 3a. R1 match: локальний запис ідентичний хмарі, серверна ревізія вища за локальну.
  let ctx = buildContext({
    tickets:[localTicketRow('t1','same')],
    cloudTickets:[cloudTicketRow('t1','same')],
    states:{ticket:[{id:'t1',revision:5,tombstone:false}],shift:[]}
  });
  await ctx.restoreFromGoogleSheets('tickets');
  assert.equal(ctx.ticketWrites,1,'match restore still writes the local base once');
  assert.equal(ctx.tickets[0].content,'same','match content is untouched');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.seeded)),[{entity:'ticket',id:'t1',revision:5,tombstone:false}],'R1: match gets the server revision');
  assert.equal(ctx.syncEngine.state.records['ticket:t1'].committedRevision,5,'R1: journal baseline equals the server revision');
  assert.equal(ctx.syncEngine.state.records['ticket:t1'].head,null,'R1: restore never enqueues a mutation');

  // 3b. R1 conflict → local: контент локальний, baseline серверний.
  ctx = buildContext({
    tickets:[localTicketRow('c1','local')],
    cloudTickets:[cloudTicketRow('c1','cloud')],
    states:{ticket:[{id:'c1',revision:6,tombstone:false}],shift:[]}
  });
  await ctx.restoreFromGoogleSheets('tickets');
  assert.equal(ctx.tickets[0].content,'local','conflict → local keeps local content');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.seeded)),[{entity:'ticket',id:'c1',revision:6,tombstone:false}],'R1: conflict → local aligns the server revision');
  assert.equal(ctx.syncEngine.state.records['ticket:c1'].committedRevision,6);

  // 3c. R2: хмарний tombstone для наявного локального запису.
  ctx = buildContext({
    tickets:[localTicketRow('z1','keep me')],
    cloudTickets:[],
    states:{ticket:[{id:'z1',revision:9,tombstone:true}],shift:[]}
  });
  await ctx.restoreFromGoogleSheets('tickets');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.tickets.map(ticket=>ticket.id))),['z1'],'R2: local record is not deleted automatically');
  assert.equal(ctx.tickets[0].content,'keep me','R2: local content is untouched');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.seeded)),[{entity:'ticket',id:'z1',revision:9,tombstone:false}],'R2: tombstoned local id aligns the server revision');
  const zombieRecord = ctx.syncEngine.state.records['ticket:z1'];
  assert.equal(zombieRecord.committedRevision,9);
  assert.equal(zombieRecord.tombstone,false,'R2: local record is not locked as deleted');
  assert.equal(zombieRecord.head,null,'R2: nothing is queued for a cloud-deleted record');
  assert.ok(ctx.modals.some(modal=>modal.body.indexOf('видалених у хмарі 1') >= 0),'R2: analysis screen reports the cloud-deleted local record');

  // 3d. Хмарний tombstone для id, якого немає локально: як і раніше не імпортується.
  ctx = buildContext({
    tickets:[],
    cloudTickets:[cloudTicketRow('t1','one')],
    states:{ticket:[{id:'t1',revision:2,tombstone:false},{id:'gone',revision:9,tombstone:true}],shift:[]}
  });
  await ctx.restoreFromGoogleSheets('tickets');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.seeded)),[{entity:'ticket',id:'t1',revision:2,tombstone:false}],'existing tombstone handling for cloud rows is unchanged');
  assert.equal(ctx.tickets.length,1,'cloud-deleted row is still never imported');

  console.log('PASS restore aligns server revisions for match/conflict and parks cloud-deleted local records without retry');
})().catch(error=>{ console.error(error); process.exitCode = 1; });
