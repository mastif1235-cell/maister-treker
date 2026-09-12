'use strict';

// `list` must expose bulk revisions (states) for tickets and shifts with one
// read-only getValues per workbook, without weakening getEntityState or the
// revision checks on mutations.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const client = require('../js/sync-contract.js');

const secret = '0123456789abcdef0123456789abcdef';
const shiftsId = 'preprod-shifts-workbook-1234567890';
const properties = new Map([
  ['MT_SYNC_HMAC_SECRET', secret],
  ['MT_SHIFTS_SPREADSHEET_ID', shiftsId]
]);
const cache = new Map();
const writes = [];
const stateReads = {ticket:0, shift:0};

function dataSheet(rows, headers, label){
  return {
    getLastRow(){ return rows.length + 1; },
    getRange(row, column, count, width){
      if(row === 1) return {getDisplayValues(){ return [headers.slice(column - 1, column - 1 + width)]; }};
      if(label) stateReads[label]++;
      return {getValues(){ return rows.slice(row - 2, row - 2 + count).map(item=>item.slice(column - 1, column - 1 + width)); }};
    },
    appendRow(){ writes.push('appendRow'); throw new Error('list must not write'); },
    insertSheet(){ writes.push('insertSheet'); throw new Error('list must not create sheets'); }
  };
}

const ticketSheet = dataSheet([
  ['t1', '23.08.2026', '10:00', 'one', 100, '', '', ''],
  ['t2', '24.08.2026', '11:00', 'two', 200, '', '', '']
], ['id','date','time','content','sum','tags','нотатки_майстра','повніДаніJSON']);
const shiftSheet = dataSheet([['s1', '23.08.2026', 8, 'Сам']], ['id','date','hours','coworker']);

// duplicate id (first row wins, same as syncReadEntityState_), mismatched
// entityType row (ignored) and a tombstone row.
const ticketStateRows = [
  ['ticket', 't1', 5, false, 'fp-t1', 'req-t1', '2026-08-23T10:00:00.000Z'],
  ['shift', 't1', 99, true, 'wrong-entity', '', ''],
  ['ticket', 't1', 99, true, 'duplicate', '', ''],
  ['ticket', 't2', 0, false, '', '', '']
];
const shiftStateRows = [
  ['shift', 's1', 3, true, 'fp-s1', 'req-s1', '2026-08-23T10:00:00.000Z'],
  ['shift', '', 4, false, '', '', '']
];
const ticketStates = dataSheet(ticketStateRows, ['entityType','entityId','revision','tombstone','fingerprint','requestId','updatedAt'], 'ticket');
const shiftStates = dataSheet(shiftStateRows, ['entityType','entityId','revision','tombstone','fingerprint','requestId','updatedAt'], 'shift');

let ticketStateSheet = ticketStates;
let shiftStateSheet = shiftStates;

const ticketWorkbook = {
  getId(){ return 'preprod-ticket-workbook-1234567890'; },
  getSpreadsheetTimeZone(){ return 'Europe/Kiev'; },
  getSheetByName(name){
    if (name === 'Заявки') return ticketSheet;
    if (name === '_SyncState') return ticketStateSheet;
    throw new Error(`ticket workbook must not read ${name}`);
  },
  insertSheet(){ writes.push('workbook.insertSheet'); throw new Error('list must not create sheets'); }
};
const shiftWorkbook = {
  getId(){ return shiftsId; },
  getSpreadsheetTimeZone(){ return 'Europe/Kiev'; },
  getSheetByName(name){
    if (name === '_ShiftsData') return shiftSheet;
    if (name === '_SyncState') return shiftStateSheet;
    throw new Error(`shift workbook must not read ${name}`);
  },
  insertSheet(){ writes.push('workbook.insertSheet'); throw new Error('list must not create sheets'); }
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
  CacheService:{getScriptCache(){ return {
    get(key){ return cache.get(key) || null; },
    put(key, value){ cache.set(key, String(value)); }
  }; }},
  LockService:{getScriptLock(){ return {waitLock(){}, releaseLock(){}}; }},
  SpreadsheetApp:{
    getActiveSpreadsheet(){ return ticketWorkbook; },
    openById(id){ assert.equal(id, shiftsId); return shiftWorkbook; }
  },
  Utilities:{
    Charset:{UTF_8:'UTF_8'}, DigestAlgorithm:{SHA_256:'SHA_256'},
    newBlob(value){ return {getBytes(){ return [...Buffer.from(String(value), 'utf8')]; }}; },
    base64EncodeWebSafe(bytes){ return Buffer.from(bytes).toString('base64url'); },
    computeDigest(_algorithm, value){ return crypto.createHash('sha256').update(String(value), 'utf8').digest(); },
    computeHmacSha256Signature(value, key){ return crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest(); },
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

(async()=>{
  async function signedGetList(nonce){
    const request = {
      v:3, method:'GET', action:'list', entity:'system', id:'',
      ts:String(Date.now()), nonce, requestId:'', body:''
    };
    const sig = await client.sign(request, secret);
    return context.doGet({parameter:{v:String(request.v), action:request.action, entity:request.entity, id:request.id, ts:request.ts, nonce:request.nonce, sig}});
  }

  const response = await signedGetList('list-states-nonce-0001');
  const body = JSON.parse(response.text);
  assert.equal(body.status, 'ok', 'signed list still succeeds');
  assert.equal(body.tickets.length, 2);
  assert.equal(body.shifts.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(body.states.ticket)), [
    {id:'t1', revision:5, tombstone:false},
    {id:'t2', revision:0, tombstone:false}
  ], 'list returns ticket revisions, first state row wins, foreign entityType ignored');
  assert.deepEqual(JSON.parse(JSON.stringify(body.states.shift)), [
    {id:'s1', revision:3, tombstone:true}
  ], 'list returns shift revisions in the shift workbook');

  assert.equal(stateReads.ticket, 1, 'one bulk state read per ticket workbook');
  assert.equal(stateReads.shift, 1, 'one bulk state read per shift workbook');
  assert.deepEqual(writes, [], 'list never writes to Google Sheets');

  // getEntityState keeps its own contract and is not replaced by list.
  const stateCalls = [];
  context.syncReadEntityState_ = (ss, entity, id)=>{
    stateCalls.push([entity, id, ss === ticketWorkbook ? 'ticket' : 'shift']);
    return {revision:7, tombstone:false, fingerprint:'fp'};
  };
  const single = JSON.parse(context.syncExecuteGet_('getEntityState', 'ticket', 't1').text);
  assert.deepEqual(stateCalls, [['ticket', 't1', 'ticket']], 'getEntityState still reads one entity');
  assert.equal(single.status, 'ok');
  assert.equal(single.state.revision, 7);

  // Missing _SyncState: empty states, no sheet creation, still read-only.
  ticketStateSheet = null;
  shiftStateSheet = null;
  const empty = JSON.parse((await signedGetList('list-states-nonce-0002')).text);
  assert.deepEqual(JSON.parse(JSON.stringify(empty.states)), {ticket:[], shift:[]}, 'missing state sheet yields empty states');
  assert.deepEqual(writes, [], 'missing state sheet is never created by list');

  // Revision checks on mutations must stay exactly as strict as before.
  const durable = {entityType:'ticket', entityId:'t1', revision:5, tombstone:false, fingerprint:'fp-t1', requestId:'req-t1', rowIndex:2};
  context.syncReadEntityState_ = ()=>({...durable});
  context.syncWriteEntityState_ = ()=>{ throw new Error('write not expected'); };
  const staleBody = JSON.stringify({action:'updateTicket', id:'t1', revision:4, date:'23.08.2026', time:'10:00', content:'old', sum:1, tags:[]});
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(staleBody), {entity:'ticket', id:'t1', action:'updateTicket', requestId:'req-0000000000001', body:staleBody}).outcome, 'STALE', 'revision below server state is still STALE');
  const gapBody = JSON.stringify({action:'updateTicket', id:'t1', revision:7, date:'23.08.2026', time:'10:00', content:'gap', sum:1, tags:[]});
  assert.equal(context.syncExecuteEntityMutation_({}, JSON.parse(gapBody), {entity:'ticket', id:'t1', action:'updateTicket', requestId:'req-0000000000002', body:gapBody}).code, 'REVISION_GAP', 'revision gaps are still rejected');

  console.log('PASS GAS list bulk states are read-only and revision checks stay strict');
})().catch(error=>{ console.error(error); process.exitCode = 1; });
