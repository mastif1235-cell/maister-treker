'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const shiftsId = 'preprod-shifts-workbook-1234567890';
const properties = new Map([
  ['MT_SYNC_HMAC_SECRET', '0123456789abcdef0123456789abcdef'],
  ['MT_SHIFTS_SPREADSHEET_ID', shiftsId]
]);

function dataSheet(rows, headers) {
  return {
    getLastRow(){ return rows.length + 1; },
    getLastColumn(){ return headers.length; },
    getRange(row, column, count, width){
      if (row === 1) {
        return {
          getDisplayValues(){ return [headers.slice(column - 1, column - 1 + width)]; }
        };
      }
      assert.equal(row, 2);
      return {
        getValues(){ return rows.slice(0, count).map((item)=>item.slice(column - 1, column - 1 + width)); },
        getDisplayValues(){ return rows.slice(0, count).map((item)=>item.slice(column - 1, column - 1 + width).map(String)); }
      };
    }
  };
}

const ticketSheet = dataSheet([['ticket-existing', '23.08.2026', '10:00', 'ticket', 1, '', '', '']], ['id','date','time','content','sum','tags','нотатки_майстра','повніДаніJSON']);
const shiftSheet = dataSheet([['shift-existing', '23.08.2026', 8, 'Сам']], ['id','date','hours','coworker']);
const workbookReads = [];
const ticketWorkbook = {
  name:'ticket',
  getId(){ return 'preprod-ticket-workbook-1234567890'; },
  getSpreadsheetTimeZone(){ return 'Europe/Kiev'; },
  getSheetByName(name){
    workbookReads.push(`ticket:${name}`);
    if (name === 'Заявки') return ticketSheet;
    if (name === '_SyncState') return null;
    throw new Error(`ticket workbook must not read ${name}`);
  }
};
const shiftWorkbook = {
  name:'shift',
  getId(){ return shiftsId; },
  getSpreadsheetTimeZone(){ return 'Europe/Kiev'; },
  getSheetByName(name){
    workbookReads.push(`shift:${name}`);
    if (name === '_ShiftsData') return shiftSheet;
    if (name === '_SyncState') return null;
    throw new Error(`shift workbook must not read ${name}`);
  }
};

const scriptProperties = {
  getProperty(key){ return properties.get(key) || null; },
  setProperty(key, value){ properties.set(key, String(value)); },
  deleteProperty(key){ properties.delete(key); },
  getProperties(){ return Object.fromEntries(properties); }
};

const context = vm.createContext({
  Array, Date, JSON, Math, Number, Object, RegExp, String,
  PropertiesService:{getScriptProperties(){ return scriptProperties; }},
  SpreadsheetApp:{
    getActiveSpreadsheet(){ return ticketWorkbook; },
    openById(id){ assert.equal(id, shiftsId); return shiftWorkbook; }
  },
  Utilities:{
    Charset:{UTF_8:'UTF_8'}, DigestAlgorithm:{SHA_256:'SHA_256'},
    newBlob(value){ return {getBytes(){ return [...Buffer.from(String(value), 'utf8')]; }}; },
    base64EncodeWebSafe(bytes){ return Buffer.from(bytes).toString('base64url'); },
    computeDigest(_algorithm, value){ return crypto.createHash('sha256').update(String(value), 'utf8').digest(); },
    formatDate(value, _tz, format){
      if (format === 'dd.MM.yyyy') return '23.08.2026';
      if (format === 'HH:mm') return '10:00';
      return String(value);
    }
  },
  ContentService:{
    MimeType:{JSON:'JSON'},
    createTextOutput(text){ return {text, setMimeType(){ return this; }}; }
  }
});

vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), context, {filename:'Code.gs'});

assert.equal(context.syncSpreadsheetForEntity_('ticket'), ticketWorkbook, 'tickets route to bound ticket workbook');
assert.equal(context.syncSpreadsheetForEntity_('shift'), shiftWorkbook, 'shifts route to configured separate workbook');
assert.throws(()=>context.syncSpreadsheetForEntity_('system'), /Unsupported entity workbook/, 'unknown entity fails closed');

const mutationCalls = [];
context.syncExecuteEntityMutation_ = (ss, _data, envelope)=>{
  mutationCalls.push([envelope.entity, ss.name]);
  return {status:'ok'};
};
context.syncExecutePost_({}, {entity:'ticket'});
context.syncExecutePost_({}, {entity:'shift'});
assert.deepEqual(mutationCalls, [['ticket', 'ticket'], ['shift', 'shift']], 'mutations use exactly one entity workbook');

const stateCalls = [];
context.syncReadEntityState_ = (ss, entity, id)=>{
  stateCalls.push([entity, id, ss.name]);
  return {revision:0, tombstone:false, fingerprint:''};
};
context.syncExecuteGet_('getEntityState', 'ticket', 'ticket-state');
context.syncExecuteGet_('getEntityState', 'shift', 'shift-state');
assert.deepEqual(stateCalls, [
  ['ticket', 'ticket-state', 'ticket'],
  ['shift', 'shift-state', 'shift']
], 'entity state is stored and read beside its entity workbook');

const list = context.syncReadAll_();
assert.equal(list.tickets.length, 1);
assert.equal(list.tickets[0].id, 'ticket-existing');
assert.equal(list.shifts.length, 1);
assert.equal(list.shifts[0].id, 'shift-existing');
assert.deepEqual(workbookReads.filter((entry)=>entry.includes('Заявки') || entry.includes('_ShiftsData')), [
  'ticket:Заявки',
  'shift:_ShiftsData'
], 'list never reads an entity from the other workbook');

assert.equal(context.syncGetCanonicalShiftSheet_(shiftWorkbook), shiftSheet, 'canonical shift sheet passes exact header gate');
const badShiftSheet = dataSheet([], ['date','weekday','hours','coworker','id']);
assert.throws(()=>context.syncGetCanonicalShiftSheet_({getSheetByName(){ return badShiftSheet; }}), /schema mismatch/, 'legacy report schema fails closed');
assert.throws(()=>context.syncGetCanonicalShiftSheet_({getSheetByName(){ return null; }}), /storage is missing/, 'missing canonical storage fails closed');

assert.deepEqual(JSON.parse(JSON.stringify(context.buildShiftReportRows_([
  {id:'s2', date:'01.08.2026', hours:8.5, coworker:'Женя'},
  {id:'s1', date:'31.07.2026', hours:7, coworker:'Сам'}
]))), [
  ['📅 МІСЯЦЬ: 2026-08','','','',''],
  ['Дата','День','Години','Напарник',''],
  ['01.08.2026','сб',8.5,'Женя','s2'],
  ['📊 РАЗОМ ЗА МІСЯЦЬ:','',8.5,'1 упряжок',''],
  ['','','','',''],
  ['📅 МІСЯЦЬ: 2026-07','','','',''],
  ['Дата','День','Години','Напарник',''],
  ['31.07.2026','пт',7,'Сам','s1'],
  ['📊 РАЗОМ ЗА МІСЯЦЬ:','',7,'1 упряжок','']
], 'accountant report is a deterministic projection of canonical storage');

properties.delete('MT_SHIFTS_SPREADSHEET_ID');
assert.throws(()=>context.syncShiftSpreadsheet_(), /not configured/, 'missing shift property fails closed');
properties.set('MT_SHIFTS_SPREADSHEET_ID', ticketWorkbook.getId());
assert.throws(()=>context.syncShiftSpreadsheet_(), /must be separate/, 'same ticket/shift workbook is rejected');

console.log('PASS ticket/shift storage router isolation and fail-closed checks');
