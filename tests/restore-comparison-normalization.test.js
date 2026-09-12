'use strict';

// Порівняння заявок у відновленні з Google Sheets: нормалізація формату не
// має створювати конфлікти, але будь-яка реальна розбіжність даних мусить
// лишатися конфліктом.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const restore = require('../js/restore-from-sheets.js');

const REPO = path.join(__dirname, '..');

function loadAppFunctions(){
  const ctx = { console, globalThis:{}, TextEncoder, TextDecoder };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext('function formatDate(d){const p=n=>String(n).padStart(2,"0");return p(d.getDate())+"."+p(d.getMonth()+1)+"."+d.getFullYear();}function formatTime(d){const p=n=>String(n).padStart(2,"0");return p(d.getHours())+":"+p(d.getMinutes());}', ctx);
  for(const file of ['js/tools-core.js', 'js/app-format-utils.js', 'js/ticket-form-domain.js']){
    vm.runInContext(fs.readFileSync(path.join(REPO, file), 'utf8'), ctx, {filename:file});
  }
  const app = fs.readFileSync(path.join(REPO, 'app.js'), 'utf8');
  vm.runInContext(app.slice(app.indexOf('function ticketToSyncPayload'), app.indexOf('function shiftToSyncPayload')) +
    '\nglobalThis.ticketToSyncPayload = ticketToSyncPayload;', ctx, {filename:'app.js:ticketToSyncPayload'});
  return ctx;
}

const app = loadAppFunctions();
const deps = {
  blankTicketObject:()=>app.blankTicketObject(),
  parseBackupNote:app.parseBackupNote,
  ticketToSyncPayload:app.ticketToSyncPayload
};

// Колонки таблиці так, як їх пише Code.gs, і так, як їх повертає list.
function sheetRow(ticket, overrides){
  const payload = deps.ticketToSyncPayload(ticket);
  return Object.assign({
    id:String(payload.id == null ? '' : payload.id),
    date:String(payload.date == null ? '' : payload.date),
    time:String(payload.time == null ? '' : payload.time),
    content:payload.content == null ? '' : String(payload.content),
    sum:Number(payload.sum) || 0,
    tags:String((payload.tags || []).join(', ')),
    backupNote:String(payload.backupNote || ''),
    fullDataJson:String(payload.fullDataJson || '')
  }, overrides || {});
}

function listRow(row){
  return {
    id:String(row.id || ''), date:String(row.date || ''), time:String(row.time || ''),
    content:row.content == null ? '' : String(row.content),
    sum:Number(row.sum) || 0,
    tags:row.tags ? String(row.tags).split(',').map(value=>value.trim()).filter(Boolean) : [],
    backupNote:String(row.backupNote || ''), fullDataJson:String(row.fullDataJson || '')
  };
}

function stats(localTicket, row){
  return restore.buildTicketPlan([localTicket], [listRow(row)], deps).stats;
}

function assertMatch(label, localTicket, row){
  const result = stats(localTicket, row);
  assert.equal(result.matchCount, 1, label + ' (match)');
  assert.equal(result.conflictCount, 0, label + ' (без конфлікту)');
}

function assertConflict(label, localTicket, row){
  const result = stats(localTicket, row);
  assert.equal(result.conflictCount, 1, label + ' (conflict)');
}

function withFullData(row, mutate){
  const full = JSON.parse(row.fullDataJson || '{}');
  mutate(full);
  return Object.assign({}, row, {fullDataJson:JSON.stringify(full)});
}

function dropFullDataKeys(row, keys){
  return withFullData(row, full=>{ keys.forEach(key=>{ delete full[key]; }); });
}

const liveTicket = Object.assign(app.blankTicketObject(), {
  id:'t1', date:'01.09.2026', time:'10:00', content:'📋 ЗАЯВКА: РЕМОНТ\nАдреса: Хрещатик 1',
  sum:500, tags:['ремонт','оплата'],
  type:'Ремонт', city:'Київ', address:'Хрещатик 1', clientName:'Іван Петренко', phone:'+380501112233',
  payment:'Готівка', cashAmount:500, cardAmount:0, baseCallFee:300, callFee:300, tariff:250,
  itemPayments:{ cash:500 }, equipment:[{name:'ONU', qty:1}], cables:[{type:'UTP', meters:20}],
  presetWorks:[{desc:'Налаштування', sum:100}], additionalWork:[{desc:'Монтаж', sum:200}],
  note:'нотатка', otherNote:'', abonentNote:'абонент', extraPhones:['+380671112233'], masterNote:'приватна',
  signal:'-20', geoLat:50.4501, geoLng:30.5234, geoLink:'https://maps.app.goo.gl/abc123',
  login:'client', password:'secret', contractNumber:'123',
  networkPointIds:['np-1','np-2'],
  diagnosticHistory:[{id:'d1', timestamp:'2026-09-01T10:00:00.000Z', profileId:'p1', summaryStatus:'ok', result:{}}]
});
const baseRow = sheetRow(liveTicket);

/* ---------- формат: має бути match ---------- */

assertMatch('свіжий round-trip приложение → таблица → list', liveTicket, baseRow);
const plainTicket = Object.assign(app.blankTicketObject(), {
  id:'t3', date:'01.09.2026', time:'10:00', content:'Заявка без нових полів',
  sum:0, tags:['ремонт'], type:'Ремонт', city:'Київ', address:'Хрещатик 1', clientName:'Іван', phone:'+380501112233'
});
const plainRow = sheetRow(plainTicket);
assertMatch('старий fullDataJson без нових полів (значення порожні)', plainTicket,
  dropFullDataKeys(plainRow, ['baseCallFee','geoLink','networkPointIds','diagnosticHistory','masterNote']));
assertMatch('старий fullDataJson без geoLink, але координати ті самі', liveTicket,
  dropFullDataKeys(baseRow, ['geoLink']));
assertConflict('старий рядок без baseCallFee, а локально є 300', liveTicket,
  dropFullDataKeys(baseRow, ['baseCallFee']));
assertMatch('числова строка проти числа', liveTicket,
  withFullData(baseRow, full=>{ full.baseCallFee='300'; full.cashAmount='500'; full.geoLat='50.4501'; full.geoLng='30.5234'; }));
assertMatch('порожнє поле проти відсутнього', plainTicket,
  dropFullDataKeys(plainRow, ['otherNote','abonentNote','signal','macAddress','extraPhones','itemPayments','geoLat','geoLng','geoLink','contractNumber','login','macAddress']));
assertConflict('відсутній телефон у таблиці, а локально він є', plainTicket,
  dropFullDataKeys(plainRow, ['phone']));
assertConflict('відсутній additionalWork-запис у таблиці, а локально він є', liveTicket,
  dropFullDataKeys(baseRow, ['additionalWork']));
assertMatch('additionalWork пустий дефолт проти []',
  Object.assign(app.blankTicketObject(), {id:'t2', date:'01.09.2026', time:'10:00', sum:0}),
  withFullData(sheetRow(Object.assign(app.blankTicketObject(), {id:'t2', date:'01.09.2026', time:'10:00', sum:0})), full=>{ full.additionalWork = []; }));
assertMatch('хвостовий пробіл і перевід рядка в content', liveTicket,
  Object.assign({}, baseRow, {content:String(baseRow.content) + ' \n'}));
assertMatch('хвостовий пробіл в адресі', liveTicket,
  withFullData(baseRow, full=>{ full.address = String(full.address) + ' '; }));
assertMatch('ISO-дата проти dd.MM.yyyy', liveTicket, Object.assign({}, baseRow, {date:'2026-09-01'}));
assertMatch('time 10:00:00 проти 10:00', liveTicket, Object.assign({}, baseRow, {time:'10:00:00'}));
assertMatch('порядок ключів JSON не важливий', liveTicket,
  (()=>{ const full = JSON.parse(baseRow.fullDataJson); const reversed = {}; Object.keys(full).reverse().forEach(key=>{ reversed[key] = full[key]; }); return Object.assign({}, baseRow, {fullDataJson:JSON.stringify(reversed)}); })());
assertMatch('теги в іншому порядку і з пробілами', liveTicket,
  Object.assign({}, baseRow, {tags:'оплата,  ремонт'}));
assertMatch('порядок networkPointIds не важливий', liveTicket,
  withFullData(baseRow, full=>{ full.networkPointIds = ['np-2','np-1']; }));
assertMatch('порядок diagnosticHistory не важливий', Object.assign({}, liveTicket, {
  diagnosticHistory:[
    {id:'d1', timestamp:'2026-09-01T10:00:00.000Z', profileId:'p1', summaryStatus:'ok', result:{}},
    {id:'d2', timestamp:'2026-09-02T10:00:00.000Z', profileId:'p1', summaryStatus:'warning', result:{}}
  ]
}), withFullData(sheetRow(Object.assign({}, liveTicket, {
  diagnosticHistory:[
    {id:'d1', timestamp:'2026-09-01T10:00:00.000Z', profileId:'p1', summaryStatus:'ok', result:{}},
    {id:'d2', timestamp:'2026-09-02T10:00:00.000Z', profileId:'p1', summaryStatus:'warning', result:{}}
  ]
})), full=>{ full.diagnosticHistory = full.diagnosticHistory.slice().reverse(); }));

/* ---------- реальні дані: має лишитися conflict ---------- */

assertConflict('інша сума', liveTicket, Object.assign({}, baseRow, {sum:900}));
assertConflict('інша сума в fullDataJson', liveTicket,
  withFullData(baseRow, full=>{ full.cashAmount = 900; }));
assertConflict('інший адрес', liveTicket, withFullData(baseRow, full=>{ full.address = 'Інша вулиця 5'; }));
assertConflict('інший телефон', liveTicket, withFullData(baseRow, full=>{ full.phone = '+380990000000'; }));
assertConflict('інше ФІО', liveTicket, withFullData(baseRow, full=>{ full.clientName = 'Інша Людина'; }));
assertConflict('інший login', liveTicket,
  Object.assign({}, baseRow, {backupNote:String(baseRow.backupNote).replace('Логін: client','Логін: hacker')}));
assertConflict('інший password', liveTicket,
  Object.assign({}, baseRow, {backupNote:String(baseRow.backupNote).replace('Пароль: secret','Пароль: newpass')}));
assertMatch('однакові координати, інший текст ссылки — та сама локація', liveTicket,
  withFullData(baseRow, full=>{ full.geoLink = 'https://www.google.com/maps/search/?api=1&query=50.4501%2C30.5234'; }));
const linkOnlyTicket = Object.assign(app.blankTicketObject(), {
  id:'t4', date:'01.09.2026', time:'10:00', content:'Заявка зі ссылкою', sum:0, tags:[],
  geoLink:'https://maps.app.goo.gl/abc123'
});
assertConflict('інший geoLink, коли координат немає', linkOnlyTicket,
  withFullData(sheetRow(linkOnlyTicket), full=>{ full.geoLink = 'https://maps.app.goo.gl/zzz999'; }));
assertConflict('інші координати', liveTicket, withFullData(baseRow, full=>{ full.geoLat = 49.84; }));
assertConflict('інші networkPointIds', liveTicket, withFullData(baseRow, full=>{ full.networkPointIds = ['np-1','np-9']; }));
assertConflict('інша diagnosticHistory', liveTicket,
  withFullData(baseRow, full=>{ full.diagnosticHistory = [{id:'d2', timestamp:'2026-09-02T10:00:00.000Z', profileId:'p1', summaryStatus:'bad', result:{}}]; }));
assertConflict('інший masterNote', liveTicket, withFullData(baseRow, full=>{ full.masterNote = 'інша приватна нотатка'; }));
assertConflict('інший текст заявки', liveTicket, Object.assign({}, baseRow, {content:'зовсім інший текст'}));
assertConflict('інша дата', liveTicket, Object.assign({}, baseRow, {date:'02.09.2026'}));
assertConflict('інше обладнання', liveTicket,
  withFullData(baseRow, full=>{ full.equipment = [{name:'ONU', qty:2}]; }));
assertConflict('інші кабелі', liveTicket,
  withFullData(baseRow, full=>{ full.cables = [{type:'UTP', meters:99}]; }));
assertConflict('інші роботи', liveTicket,
  withFullData(baseRow, full=>{ full.additionalWork = [{desc:'Інша робота', sum:200}]; }));
assertConflict('порядок additionalWork важливий', liveTicket,
  withFullData(baseRow, full=>{ full.additionalWork = [{desc:'Монтаж', sum:200},{desc:'Додаткова', sum:50}]; }));

/* ---------- зсуви ---------- */

const shift = { id:'s1', date:'01.09.2026', hours:8, coworker:'Сам' };
const shiftPlan = restore.buildShiftPlan([shift], [{ id:'s1', date:'01.09.2026', hours:8, coworker:'Сам' }]);
assert.equal(shiftPlan.stats.matchCount, 1, 'зсув: той самий склад — match');
assert.equal(
  restore.canonicalShift(shift),
  restore.canonicalShift({ id:'s1', date:'2026-09-01', hours:'8', coworker:' Сам ' }),
  'зсув: ISO-дата, string-години і пробіли нормалізуються'
);
const shiftConflict = restore.buildShiftPlan([shift], [{ id:'s1', date:'01.09.2026', hours:9, coworker:'Сам' }]);
assert.equal(shiftConflict.stats.conflictCount, 1, 'зсув: інші години — conflict');

console.log('PASS restore comparison normalizes format only and keeps every real difference a conflict');
