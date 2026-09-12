'use strict';

// Імпорт заявки з Google Sheets і відновлення з бекапу — це вхід зовнішніх
// даних. Історія діагностик мусить переживати обидва шляхи, лишатися
// обмеженою за розміром і не втрачати найновіші записи.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const REPO = path.join(__dirname, '..');
const core = require('../js/tools-core.js');
globalThis.MTToolsCore = core;
const restore = require('../js/restore-from-sheets.js');

function loadAppFunctions(){
  const ctx = { console, globalThis:{}, TextEncoder, TextDecoder };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for(const file of ['js/tools-core.js', 'js/app-format-utils.js', 'js/ticket-form-domain.js']){
    vm.runInContext(fs.readFileSync(path.join(REPO, file), 'utf8'), ctx, {filename:file});
  }
  return ctx;
}

const app = loadAppFunctions();

function parseBackupNote(note){
  const result = {geoLink:'', masterNote:'', login:'', password:'', fullData:null};
  String(note || '').replace(/\r\n?/g, '\n').split('\n').forEach(line=>{
    let match = line.match(/^Геолокація:\s*(.+)$/);
    if(match){ result.geoLink = match[1].trim(); return; }
    match = line.match(/^Логін:\s*(.+)$/);
    if(match){ result.login = match[1].trim(); return; }
    match = line.match(/^Пароль:\s*(.+)$/);
    if(match){ result.password = match[1].trim(); return; }
  });
  return result;
}

const deps = {blankTicketObject:()=>app.blankTicketObject(), parseBackupNote};

const diag = index=>({
  id:'diag-' + index,
  timestamp:new Date(Date.UTC(2026, 8, 1, 0, 0, index % 60)).toISOString(),
  version:'browser-v2', profileId:'p1', address:'Київ', summaryStatus:'ok',
  result:{summaryStatus:'ok', latencyMs:index}
});

function sheetRow(id, fullData){
  return {
    id, date:'01.09.2026', time:'10:00', content:'Заявка', sum:0, tags:'підключення',
    backupNote:'', fullDataJson:JSON.stringify(fullData)
  };
}

/* ---------- імпорт із таблиці ---------- */

const history = [diag(1), diag(2), diag(3)];
const fresh = sheetRow('t1', {city:'Київ', address:'Хрещатик 1', diagnosticHistory:history, networkPointIds:['np-1','np-1',' np-2 ']});
const freshTicket = restore.cloudTicketToLocal(fresh, deps).ticket;
assert.deepEqual(freshTicket.diagnosticHistory.map(item=>item.id), ['diag-1','diag-2','diag-3'],
  'історія діагностик переноситься з fullDataJson у заявку');
assert.deepEqual(freshTicket.networkPointIds, ['np-1','np-2'],
  'привʼязки до точок нормалізуються: дублікати й пробіли прибираються');

const junkRow = sheetRow('t2', {city:'Київ', diagnosticHistory:'не масив', networkPointIds:'np-1'});
const junkTicket = restore.cloudTicketToLocal(junkRow, deps).ticket;
assert.deepEqual(junkTicket.diagnosticHistory, [], 'пошкоджена історія з таблиці не потрапляє в заявку');
assert.deepEqual(junkTicket.networkPointIds, [], 'пошкоджені привʼязки з таблиці не потрапляють у заявку');

const longRow = sheetRow('t3', {city:'Київ', diagnosticHistory:Array.from({length:600}, (_v,index)=>diag(index + 1))});
const longTicket = restore.cloudTicketToLocal(longRow, deps).ticket;
assert.equal(longTicket.diagnosticHistory.length, 200, 'історія з таблиці обрізається до 200 записів');
assert.equal(longTicket.diagnosticHistory[199].id, 'diag-600', 'лишаються найновіші записи історії');
assert.equal(longTicket.diagnosticHistory[0].id, 'diag-401', 'найстаріші записи історії відкидаються першими');

const legacyRow = {id:'legacy-1', date:'01.09.2026', time:'10:00', content:'Стара заявка', sum:0, tags:'', backupNote:'', fullDataJson:''};
const legacyTicket = restore.cloudTicketToLocal(legacyRow, deps).ticket;
assert.equal(legacyTicket.diagnosticHistory.length, 0, 'стара заявка без історії отримує порожню історію');
assert.equal(legacyTicket.networkPointIds.length, 0, 'стара заявка без привʼязок отримує порожній список');
assert.equal(legacyTicket.cloudImported, true, 'імпортована заявка лишається позначеною як хмарна');

// Той самий шлях, яким користується відновлення: план → застосування.
const applied = restore.applyTicketPlan([], [fresh, longRow], {}, deps);
assert.equal(applied.length, 2, 'усі нові рядки хмари імпортуються');
assert.equal(applied[0].diagnosticHistory.length, 3, 'застосування плану зберігає історію заявки');
assert.equal(applied[1].diagnosticHistory.length, 200, 'застосування плану теж обрізає історію з таблиці');

/* ---------- бекап/імпорт: межа історії ---------- */

function loadSecurityRuntime(){
  const ctx = {console, Number, Math, String, Array, Object, Date, JSON, URL, Set, Map, globalThis:{}};
  ctx.document = {addEventListener(){}};
  ctx.location = {href:'https://example.test/'};
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.MTToolsCore = core;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(REPO, 'js/security-runtime-v65-9.js'), 'utf8'), ctx, {filename:'js/security-runtime-v65-9.js'});
  return ctx;
}

const security = loadSecurityRuntime();
const sanitized = security.securityRuntimeSanitizeTicket({id:'t9', diagnosticHistory:Array.from({length:300}, (_v,index)=>diag(index + 1))}, 0);
assert.ok(sanitized.diagnosticHistory.length <= 200, 'обмеження історії тримається і на імпорті з бекапу');
assert.equal(sanitized.diagnosticHistory[sanitized.diagnosticHistory.length - 1].id, 'diag-300',
  'найновіший запис діагностики не втрачається, коли історія обрізається');
assert.equal(sanitized.diagnosticHistory[0].id, 'diag-101', 'старі записи діагностики відкидаються першими');

const hugeImport = security.securityRuntimeSanitizeTicket({id:'t10', diagnosticHistory:Array.from({length:700}, (_v,index)=>diag(index + 1))}, 0);
assert.equal(hugeImport.diagnosticHistory.length, 200, 'завелика історія з бекапу обрізається до 200 записів');
assert.equal(hugeImport.diagnosticHistory[199].id, 'diag-700', 'обрізання великої історії лишає найновіший запис');
assert.equal(hugeImport.diagnosticHistory[0].id, 'diag-501', 'обрізання великої історії не втрачає записи з середини');

console.log('PASS diagnostics survive Sheets import and backup import bounded, newest-first');
