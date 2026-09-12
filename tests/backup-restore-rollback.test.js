'use strict';

// Відновлення з файлу бекапу: перед заміною даних має лишатися локальна
// pre-restore копія, а помилка на будь-якому кроці — повертати і памʼять, і
// те, що вже встигло записатися на диск.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'backup-system.js'), 'utf8')
  .replace('  async function mtBackupMigrateLegacySlots(){', '  globalThis.__mtBackupRestore=mtBackupRestore;\n  async function mtBackupMigrateLegacySlots(){');

function createContext(options){
  options = options || {};
  const state = {
    keys:[],
    entries:new Map(),
    ticketWrites:[],
    shiftWrites:[],
    toolsWrites:[],
    indexWrites:[],
    settingsWrites:[]
  };
  const context = {
    console, crypto:webcrypto, TextEncoder, TextDecoder, Blob, btoa, atob,
    URL:{createObjectURL:()=>'', revokeObjectURL:()=>{}}, setTimeout:()=>1, clearTimeout:()=>{},
    document:{getElementById:()=>null, createElement:()=>({click(){}})},
    prompt:()=>null, confirm:()=>true, openConfirmModal:async()=>true, showToast:()=>{},
    localStorage:{getItem:()=>null, setItem(){}, removeItem(){}},
    localDateKey:()=>'2026-09-12',
    backupDb:{name:'fake'},
    DAILY_BACKUP_MAX:10,
    loadDailyBackupIndex:()=>[],
    saveDailyBackupIndex:index=>{state.indexWrites.push(JSON.parse(JSON.stringify(index)));},
    backupDbGet:async key=>state.entries.get(key)||null,
    backupDbPut:async(key, value)=>{state.keys.push(key); state.entries.set(key, JSON.parse(JSON.stringify(value))); return true;},
    backupDbDelete:async key=>state.entries.delete(key),
    blankTicketObject:()=>({}),
    securityRuntimeSanitizeTicket:value=>value,
    securitySanitizeSettingsForBackup:value=>value,
    securityMergeImportedSettings:(imported, current)=>Object.assign({}, current, imported),
    toolsExportData:()=>({diagnostics:state.diagnostics, networkPoints:state.points}),
    toolsRestoreData:data=>{
      if(Array.isArray(data.diagnostics)){state.diagnostics=JSON.parse(JSON.stringify(data.diagnostics)); state.toolsWrites.push('diagnostics');}
      if(Array.isArray(data.networkPoints)){state.points=JSON.parse(JSON.stringify(data.networkPoints)); state.toolsWrites.push('networkPoints');}
    },
    saveSettings(){state.settingsWrites.push(JSON.parse(JSON.stringify(context.settings)));},
    renderTicketsScreen(){}, renderShiftsScreen(){}, renderSettingsScreen(){},
    saveTickets:async()=>{}, saveShifts:async()=>{},
    saveTicketsLocalOnly:async()=>{state.ticketWrites.push(JSON.parse(JSON.stringify(context.tickets))); return true;},
    saveShiftsLocalOnly:async()=>{
      if(options.failShifts) return false;
      state.shiftWrites.push(JSON.parse(JSON.stringify(context.shifts)));
      return true;
    },
    photoDbPut:async()=>true, migrateLegacyPhotosToIdb:async()=>{},
    MTSyncEngineRuntime:{uuid:()=>'uuid'},
    state
  };
  context.tickets = [{id:'t1', content:'поточна заявка'}];
  context.shifts = [{id:'s1', hours:9}];
  context.syncTicketsSnapshot = [{id:'t1', content:'поточна заявка'}];
  context.syncShiftsSnapshot = [{id:'s1', hours:9}];
  context.settings = {theme:'dark'};
  state.diagnostics = [{id:'diag-local'}];
  state.points = [{id:'np-local', lat:50.45, lng:30.52}];
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

const backupPayload = {
  app:'master-tracker', backupVersion:6,
  tickets:[{id:'t1', content:'заявка з бекапу'}, {id:'t2', content:'друга'}],
  shifts:[{id:'s1', date:'01.09.2026', hours:5, coworker:'Сам'}],
  settings:{theme:'light'},
  diagnostics:[{id:'diag-backup'}],
  networkPoints:[{id:'np-backup', lat:1, lng:2}]
};

(async()=>{
  /* ---------- успішне відновлення лишає pre-restore копію ---------- */

  const ok = createContext({});
  const restored = await ok.__mtBackupRestore(vm.runInContext('(' + JSON.stringify(backupPayload) + ')', ok));
  assert.equal(restored, true, 'відновлення з бекапу завершується успішно');
  assert.equal(ok.tickets[0].content, 'заявка з бекапу', 'заявки з бекапу застосовано');
  assert.equal(ok.shifts[0].hours, 5, 'зміни з бекапу застосовано');
  assert.equal(ok.settings.theme, 'light', 'налаштування з бекапу застосовано');
  assert.equal(ok.state.diagnostics[0].id, 'diag-backup', 'діагностика з бекапу застосована');
  assert.equal(ok.state.points[0].id, 'np-backup', 'мережеві точки з бекапу застосовані');

  const preRestoreKeys = ok.state.keys.filter(key=>String(key).startsWith('pre-restore-'));
  assert.equal(preRestoreKeys.length, 1, 'перед заміною даних створюється pre-restore копія');
  const snapshot = ok.state.entries.get(preRestoreKeys[0]);
  assert.equal(snapshot.tickets[0].content, 'поточна заявка', 'копія містить стан до відновлення');
  assert.equal(snapshot.settings.theme, 'dark', 'копія містить налаштування до відновлення');
  assert.equal(snapshot.diagnostics[0].id, 'diag-local', 'копія містить інструменти до відновлення');
  assert.equal(ok.state.indexWrites[0][0].date, preRestoreKeys[0], 'pre-restore копія потрапляє в індекс бекапів');

  /* ---------- помилка в середині відновлення відкочує все ---------- */

  const failing = createContext({failShifts:true});
  let error = null;
  try{
    await failing.__mtBackupRestore(vm.runInContext('(' + JSON.stringify(backupPayload) + ')', failing));
  }catch(_error){ error = _error; }
  assert.ok(error, 'помилка запису змін не ковтається');
  assert.equal(error.message, 'SHIFT_WRITE_FAILED', 'помилка доходить до виклику');

  assert.equal(failing.tickets[0].content, 'поточна заявка', 'памʼять повертається до стану до відновлення');
  assert.equal(failing.shifts[0].hours, 9, 'зміни лишаються недоторканими');
  assert.equal(failing.settings.theme, 'dark', 'налаштування повертаються до попередніх');
  assert.equal(failing.state.diagnostics[0].id, 'diag-local', 'діагностика повертається до попередньої');
  assert.equal(failing.state.points[0].id, 'np-local', 'мережеві точки повертаються до попередніх');
  assert.deepEqual(JSON.parse(JSON.stringify(failing.syncTicketsSnapshot)), [{id:'t1', content:'поточна заявка'}],
    'синхронізаційний знімок заявок повертається разом із даними');

  const lastTicketWrite = failing.state.ticketWrites[failing.state.ticketWrites.length - 1];
  assert.equal(lastTicketWrite[0].content, 'поточна заявка', 'на диск повертається попередній стан заявок');
  assert.ok(failing.state.settingsWrites.length > 0, 'налаштування повертаються не лише в памʼяті');
  assert.ok(failing.state.toolsWrites.length > 0, 'інструменти повертаються не лише в памʼяті');
  assert.equal(failing.state.entries.size, 1, 'невдале відновлення не затирає pre-restore копію');

  console.log('PASS backup restore keeps a pre-restore copy and rolls memory and storage back on failure');
})().catch(error=>{console.error(error); process.exitCode = 1;});
