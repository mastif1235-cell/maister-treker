'use strict';

/* End-to-end sync harness: the REAL Code.gs executed against an in-memory
   Google Sheets emulation, plus "device" vm contexts that run the REAL browser
   sync stack (sync-contract → sync-transport → sync-engine-core →
   sync-engine-runtime) and, on demand, the real backup-system.js and
   restore-from-sheets.js browser runtimes.

   Nothing here touches production: the "server" is a Map + arrays in this
   process, every device is a fresh vm context with its own journal double.
   Signatures, nonces, idempotency records, the _SyncState revision gate,
   the Заявки sheet and the `list` payload (what the MCP Worker consumes) are
   all produced by the real Apps Script code. */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

const root = path.join(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));

const TICKET_HEADERS = ['id', 'date', 'time', 'content', 'sum', 'tags', 'нотатки_майстра', 'повніДаніJSON'];
const SHIFT_HEADERS = ['id', 'date', 'hours', 'coworker'];
const HMAC_SECRET = 'harness-secret-0123456789abcdef0123456789abcdef';

/* ---------- in-memory Google Sheets ---------- */

function makeSheet(name, headers){
  const rows = headers ? [headers.slice()] : [];
  let sheetName = name;
  const sheet = {
    rows,
    getName(){ return sheetName; },
    setName(next){ sheetName = String(next); return sheet; },
    getLastRow(){ return rows.length; },
    getLastColumn(){ return rows.reduce((max, row) => Math.max(max, row.length), 0); },
    getMaxRows(){ return Math.max(rows.length, 1000); },
    appendRow(row){ rows.push(row.slice()); return sheet; },
    insertRowBefore(index){ rows.splice(index - 1, 0, []); return sheet; },
    deleteRow(index){ rows.splice(index - 1, 1); return sheet; },
    hideSheet(){ return sheet; }, autoResizeRows(){ return sheet; },
    showColumns(){ return sheet; }, hideColumns(){ return sheet; }, setColumnWidth(){ return sheet; },
    getRange(row, col, numRows, numCols){
      numRows = numRows === undefined ? 1 : numRows;
      numCols = numCols === undefined ? 1 : numCols;
      const range = {
        getValues(){
          const out = [];
          for(let r = 0; r < numRows; r++){
            const src = rows[row - 1 + r] || [];
            const line = [];
            for(let c = 0; c < numCols; c++){ const v = src[col - 1 + c]; line.push(v === undefined ? '' : v); }
            out.push(line);
          }
          return out;
        },
        getDisplayValues(){ return range.getValues().map(line => line.map(v => (v === null || v === undefined) ? '' : String(v))); },
        setValues(values){
          values.forEach((line, r) => {
            while(rows.length < row + r) rows.push([]);
            const dst = rows[row - 1 + r];
            line.forEach((v, c) => { dst[col - 1 + c] = v; });
          });
          return range;
        },
        clearContent(){
          for(let r = 0; r < numRows; r++){ const dst = rows[row - 1 + r]; if(!dst) continue; for(let c = 0; c < numCols; c++) dst[col - 1 + c] = ''; }
          return range;
        },
        setNumberFormat(){ return range; }, setWrap(){ return range; }, setBackground(){ return range; },
        setFontWeight(){ return range; }, setBorder(){ return range; }, breakApart(){ return range; }
      };
      return range;
    }
  };
  return sheet;
}

function makeWorkbook(id, timeZone, sheets){
  const list = sheets.slice();
  return {
    getId(){ return id; },
    getSpreadsheetTimeZone(){ return timeZone; },
    getSheetByName(name){ return list.find(sheet => sheet.getName() === name) || null; },
    insertSheet(name){ const sheet = makeSheet(name); list.push(sheet); return sheet; },
    deleteSheet(sheet){ const index = list.indexOf(sheet); if(index >= 0) list.splice(index, 1); }
  };
}

/* ---------- real Code.gs server ---------- */

function createServer(options){
  options = options || {};
  const secret = options.secret || HMAC_SECRET;
  const shiftsId = 'harness-shifts-workbook-id-1234567890';
  const properties = new Map([['MT_SYNC_HMAC_SECRET', secret], ['MT_SHIFTS_SPREADSHEET_ID', shiftsId]]);
  const cache = new Map();
  const ticketWorkbook = makeWorkbook('harness-ticket-workbook-id-1234567890', 'Europe/Kiev', [makeSheet('Заявки', TICKET_HEADERS)]);
  const shiftWorkbook = makeWorkbook(shiftsId, 'Europe/Kiev', [makeSheet('_ShiftsData', SHIFT_HEADERS)]);
  const scriptProperties = {
    getProperty(key){ return properties.has(key) ? properties.get(key) : null; },
    setProperty(key, value){ properties.set(key, String(value)); },
    deleteProperty(key){ properties.delete(key); },
    getProperties(){ return Object.fromEntries(properties); }
  };
  const context = vm.createContext({
    Array, Date, JSON, Math, Number, Object, RegExp, String,
    Utilities: {
      Charset: {UTF_8: 'UTF_8'},
      DigestAlgorithm: {SHA_256: 'SHA_256'},
      newBlob(value){ return {getBytes(){ return [...Buffer.from(String(value), 'utf8')]; }}; },
      base64EncodeWebSafe(bytes){ return Buffer.from(bytes).toString('base64url'); },
      computeDigest(_algorithm, value){ return nodeCrypto.createHash('sha256').update(String(value), 'utf8').digest(); },
      computeHmacSha256Signature(value, key){ return nodeCrypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest(); },
      formatDate(value){ return String(value); }
    },
    PropertiesService: {getScriptProperties(){ return scriptProperties; }},
    CacheService: {getScriptCache(){ return {
      get(key){ return cache.has(key) ? cache.get(key) : null; },
      put(key, value){ cache.set(key, String(value)); }
    }; }},
    LockService: {getScriptLock(){ return {waitLock(){}, releaseLock(){}}; }},
    ContentService: {MimeType: {JSON: 'JSON'}, createTextOutput(text){ return {text, setMimeType(){ return this; }}; }},
    SpreadsheetApp: {
      BorderStyle: {SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM'},
      getActiveSpreadsheet(){ return ticketWorkbook; },
      openById(id){ if(id !== shiftsId) throw new Error('unknown workbook ' + id); return shiftWorkbook; }
    }
  });
  vm.runInContext(read('Code.gs'), context, {filename: 'Code.gs'});

  const requests = [];
  function call(method, url, body){
    if(method === 'POST'){
      const out = context.doPost({postData: {contents: String(body)}});
      requests.push({method, body: JSON.parse(String(body)), response: JSON.parse(out.text)});
      return out.text;
    }
    const parameter = {};
    new URL(String(url), 'https://gas.harness.test').searchParams.forEach((value, key) => { parameter[key] = value; });
    const out = context.doGet({parameter});
    requests.push({method, action: parameter.action, response: JSON.parse(out.text)});
    return out.text;
  }
  function stateSheetRows(){
    const sheet = ticketWorkbook.getSheetByName('_SyncState');
    return sheet ? sheet.rows.slice(1) : [];
  }
  return {
    context, secret, call, requests,
    ticketSheet: ticketWorkbook.getSheetByName('Заявки'),
    ticketRow(id){
      const row = ticketWorkbook.getSheetByName('Заявки').rows.slice(1).find(line => String(line[0]) === String(id));
      if(!row) return null;
      return {id: String(row[0]), date: row[1], time: row[2], content: row[3], sum: row[4], tags: row[5], backupNote: row[6], fullDataJson: row[7]};
    },
    ticketIds(){ return ticketWorkbook.getSheetByName('Заявки').rows.slice(1).map(line => String(line[0])); },
    state(entity, id){
      const row = stateSheetRows().find(line => String(line[0]) === entity && String(line[1]) === String(id));
      return row ? {revision: Number(row[2]) || 0, tombstone: row[3] === true || String(row[3]).toLowerCase() === 'true', fingerprint: String(row[4] || ''), requestId: String(row[5] || '')} : {revision: 0, tombstone: false, fingerprint: '', requestId: ''};
    }
  };
}

/* ---------- device (browser) contexts ---------- */

function journalDouble(seed){
  let value = clone(seed || {records: {}});
  let saves = 0;
  return {
    load: async () => clone(value),
    save: async next => { saves++; value = clone(next); },
    value: () => clone(value),
    saves: () => saves
  };
}

/* Mirror of app.js ticketToSyncPayload for the fields the server validates. */
function ticketToSyncPayload(t){
  const fullData = {
    type: t.type, city: t.city, street: t.street, house: t.house, apartment: t.apartment, address: t.address,
    clientName: t.clientName, phone: t.phone, note: t.note, masterNote: t.masterNote
  };
  return {
    id: String(t.id), date: String(t.date || ''), time: String(t.time || ''), content: String(t.content || ''),
    sum: Number(t.sum) || 0, tags: Array.isArray(t.tags) ? t.tags.slice() : [], backupNote: '',
    fullDataJson: JSON.stringify(fullData)
  };
}
function shiftToSyncPayload(s){ return {id: String(s.id), date: String(s.date || ''), hours: Number(s.hours) || 0, coworker: String(s.coworker || 'Сам')}; }

function blankTicketObject(){
  return {id: null, date: '', time: '', content: '', sum: 0, tags: [], photo: null, photos: [], type: 'Підключення', city: '', address: '', clientName: '', phone: '', street: '', house: '', apartment: '', note: '', masterNote: '', login: '', password: '', networkPointIds: [], diagnosticHistory: [], cloudImported: false};
}
function parseBackupNote(){ return {geoLink: '', masterNote: '', login: '', password: '', fullData: null}; }

function fakeElement(){
  return {
    textContent: '', style: {}, dataset: {},
    set onclick(fn){ if(typeof fn === 'function') fn(); },
    get onclick(){ return null; },
    set disabled(_value){}, get disabled(){ return false; },
    querySelector(){ return fakeElement(); },
    querySelectorAll(){ return []; },
    classList: {toggle(){}, add(){}, remove(){}}
  };
}

/* options: {server, name, tickets, shifts, journal, modules:['backup','restore'],
             password, online, settings}. Returns the vm context (with the
             real Engine at ctx.syncEngine) plus helpers. */
async function createDevice(options){
  const server = options.server;
  const modules = new Set(options.modules || []);
  const storage = journalDouble(options.journal);
  const downloads = [];
  const encrypted = [];
  const backupDbStore = new Map();
  const localStore = new Map();
  const toasts = [];
  const modals = [];
  const password = options.password || 'harness-backup-password';
  let online = options.online !== false;

  const ctx = {
    console, crypto: nodeCrypto.webcrypto, TextEncoder, TextDecoder, btoa, atob,
    URL: {createObjectURL: () => 'blob:harness', revokeObjectURL(){}},
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    Blob: function(parts){ downloads.push(parts.join('')); },
    navigator: {get onLine(){ return online; }},
    localStorage: {getItem: key => localStore.has(key) ? localStore.get(key) : null, setItem: (key, value) => localStore.set(key, String(value)), removeItem: key => localStore.delete(key)},
    // Backup password modal (mtBackupPasswordModal): the inputs carry the
    // harness password and pressing «OK» happens as soon as the handler is bound.
    document: {
      getElementById: id => {
        if(id === 'mtBackupPw1' || id === 'mtBackupPw2') return {value: password, onkeydown: null};
        if(id === 'mtBackupPwError') return {textContent: ''};
        if(id === 'mtBackupPwOk') return {set onclick(fn){ if(typeof fn === 'function') fn(); }, get onclick(){ return null; }};
        if(id === 'mtBackupPwCancel') return {onclick: null};
        return null;
      },
      createElement: () => ({click(){}}), addEventListener(){}, removeEventListener(){}, querySelector: () => null
    },
    prompt: () => password,
    confirm: () => true,
    showToast: message => toasts.push(String(message)),
    openConfirmModal: async () => true,
    closeModal(){},
    escapeHtml: value => String(value),
    MTSafeError: {reportError(){}},
    settings: Object.assign({theme: 'dark', scriptUrl: 'https://gas.harness.test/exec', syncHmacSecret: server.secret}, options.settings || {}),
    tickets: clone(options.tickets || []),
    shifts: clone(options.shifts || []),
    deletedTickets: [],
    syncTicketsSnapshot: clone(options.tickets || []),
    syncShiftsSnapshot: clone(options.shifts || []),
    blankTicketObject, parseBackupNote, ticketToSyncPayload, shiftToSyncPayload,
    getScriptUrl: () => 'https://gas.harness.test/exec',
    saveSettings(){},
    saveTicketsLocalOnly: async () => { ctx.ticketWrites++; return true; },
    saveShiftsLocalOnly: async () => { ctx.shiftWrites++; return true; },
    ticketWrites: 0, shiftWrites: 0,
    photoDbPut: async () => true,
    migrateLegacyPhotosToIdb: async () => {},
    collectLocalPhotoData: async () => ({photoData: {}, missingPhotos: 0}),
    securityRuntimeSanitizeTicket: value => value,
    // securityStripSystemSecrets / securitySanitizeSettingsForBackup /
    // securityMergeImportedSettings come from the REAL js/security-hardening.js
    // (loaded below), so the backup payloads are sanitized exactly like in the app.
    location: {href: 'https://mastif1235-cell.github.io/maister-treker/'},
    toolsExportData: () => ({diagnostics: [], networkPoints: []}),
    renderTicketsScreen(){}, renderShiftsScreen(){}, renderSettingsScreen(){}, renderDailyBackupList(){},
    backupDb: {},
    backupDbGet: async key => backupDbStore.has(key) ? backupDbStore.get(key) : null,
    backupDbPut: async (key, value) => { backupDbStore.set(key, value); return true; },
    backupDbDelete: async key => backupDbStore.delete(key),
    loadDailyBackupIndex: () => { try{ return JSON.parse(localStore.get('dailyBackupIndex') || '[]'); }catch(_e){ return []; } },
    saveDailyBackupIndex: index => localStore.set('dailyBackupIndex', JSON.stringify(index)),
    DAILY_BACKUP_MAX: 10,
    localDateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    openModal(title, body, opts){ modals.push({title: String(title), body: String(body)}); if(opts && typeof opts.onOpen === 'function') opts.onOpen(fakeElement()); },
    __gasCall: (method, url, body) => server.call(method, url, body)
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for(const file of ['js/security-hardening.js', 'js/sync-contract.js', 'js/sync-transport.js', 'js/sync-engine-core.js', 'js/sync-engine-runtime.js']){
    vm.runInContext(read(file), ctx, {filename: file});
  }
  if(modules.has('backup')){
    // Same trick as tests/backup-restore-local-only.test.js: expose the inner restore function.
    const source = read('js/backup-system.js').replace('  async function mtBackupMigrateLegacySlots(){', '  globalThis.__mtBackupRestore=mtBackupRestore;\n  async function mtBackupMigrateLegacySlots(){');
    vm.runInContext(source, ctx, {filename: 'js/backup-system.js'});
    if(typeof ctx.__mtBackupRestore !== 'function') throw new Error('harness: mtBackupRestore hook missing');
    const realEncrypt = ctx.MTBackupSystem.encrypt;
    ctx.MTBackupSystem.encrypt = async (payload, password) => { encrypted.push(clone(payload)); return realEncrypt(payload, password); };
  }
  if(modules.has('restore')) vm.runInContext(read('js/restore-from-sheets.js'), ctx, {filename: 'js/restore-from-sheets.js'});

  vm.runInContext(`
    globalThis.__fetch = async function(url, opts){
      const method = (opts && opts.method) || 'GET';
      const text = __gasCall(method, String(url), opts && opts.body);
      return {ok:true, status:200, json:async()=>JSON.parse(text)};
    };
    globalThis.__createTransport = function(options){ return MTSyncTransport.create(Object.assign({fetch:__fetch}, options)); };
    globalThis.__createEngine = function(options){ return new MTSyncEngineRuntime.Engine(options); };
    globalThis.MTSyncJournalStorage = {save:async function(state){ return __journalSave(state); }, load:async function(){ return __journalLoad(); }};
  `, ctx, {filename: 'harness-bootstrap.js'});
  ctx.__journalSave = state => storage.save(state);
  ctx.__journalLoad = () => storage.load();

  const transport = ctx.__createTransport({
    url: () => 'https://gas.harness.test/exec',
    secret: () => String(ctx.settings.syncHmacSecret || ''),
    random: () => nodeCrypto.randomUUID(),
    now: () => Date.now(),
    postTimeoutMs: 8000, verifyTimeoutMs: 4000, verifyDelays: [0]
  });
  const sendLog = [];
  const realSend = transport.send;
  transport.send = async mutation => {
    const result = await realSend(mutation);
    sendLog.push({
      entity: mutation.entity, id: String(mutation.id), action: mutation.action, revision: mutation.revision,
      ok: !!result.ok,
      outcome: result.ok ? String((result.result && result.result.outcome) || (result.state ? 'VERIFIED' : '')) : String((result.result && result.result.code) || 'NETWORK'),
      serverRevision: result.state ? Number(result.state.revision) : (result.result && result.result.state ? Number(result.result.state.revision) : null)
    });
    return result;
  };
  const engine = await ctx.__createEngine({
    core: ctx.MTSyncEngineCore, storage, transport,
    payload: (entity, item) => entity === 'ticket' ? ticketToSyncPayload(item) : shiftToSyncPayload(item),
    online: () => online && !!ctx.settings.syncHmacSecret,
    setTimeout: () => 0, clearTimeout(){},
    onChange(){}
  }).init();
  ctx.syncEngine = engine;

  const parseInRealm = vm.runInContext('JSON.parse', ctx);
  const device = {
    name: options.name || 'device', ctx, engine, transport, storage, sendLog, toasts, modals, downloads, encrypted, backupDbStore, localStore,
    setOnline(value){ online = !!value; },
    /* Objects created in another realm fail backup-system's isPlainObject
       (prototype identity), exactly like a browser would parse the file. */
    intoRealm(value){ return parseInRealm(JSON.stringify(value)); },
    /* handleJsonImportFile() after decrypt/validation → mtBackupRestore(payload). */
    restoreFileBackup(payload){ return ctx.__mtBackupRestore(device.intoRealm(payload)); },
    journal(){ return storage.value(); },
    record(entity, id){ return storage.value().records[ctx.MTSyncEngineCore.key(entity, id)] || null; },
    /* app.js isEntitySynced(): what the ✅/⏳ badge shows */
    isSynced(entity, id){ const record = engine.state.records[ctx.MTSyncEngineCore.key(entity, id)]; return !record || (!record.head && !record.tail); },
    conflict(entity, id){ return engine.conflictFor(entity, id); },
    async flush(){ await (engine.loop || engine.flush()); await engine.write; },
    /* Exactly what saveTickets() does: journal diff snapshot → new state, then flush. */
    async saveTickets(){
      const before = clone(ctx.syncTicketsSnapshot);
      const after = clone(ctx.tickets);
      await engine.recordDiff('ticket', before, after);
      ctx.syncTicketsSnapshot = after;
      await device.flush();
    },
    async addTicket(ticket){ ctx.tickets = ctx.tickets.concat([Object.assign(blankTicketObject(), ticket)]); await device.saveTickets(); },
    async editTicket(id, patch){ ctx.tickets = ctx.tickets.map(t => String(t.id) === String(id) ? Object.assign({}, t, patch) : t); await device.saveTickets(); },
    ticket(id){ return ctx.tickets.find(t => String(t.id) === String(id)) || null; },
    async listFromServer(){ const response = await transport.listAll(); return response.result; }
  };
  return device;
}

module.exports = {createServer, createDevice, journalDouble, ticketToSyncPayload, shiftToSyncPayload, blankTicketObject, clone, HMAC_SECRET};
