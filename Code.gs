var TICKET_HEADERS = ['id','date','time','content','sum','tags','нотатки_майстра','повніДаніJSON'];
var SHIFT_HEADERS  = ['id','date','hours','coworker'];
var SHIFT_STORAGE_SHEET = '_ShiftsData';
var SHIFT_REPORT_SHEET = 'Зміни';
var SYNC_STATE_SHEET = '_SyncState';
var SYNC_STATE_HEADERS = ['entityType','entityId','revision','tombstone','fingerprint','requestId','updatedAt'];

var SYNC_PROTOCOL_VERSION = 3;
var SYNC_HMAC_PROPERTY = 'MT_SYNC_HMAC_SECRET';
var SYNC_SHIFTS_SPREADSHEET_PROPERTY = 'MT_SHIFTS_SPREADSHEET_ID';
var SYNC_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
var SYNC_NONCE_TTL_SECONDS = 10 * 60;
var SYNC_MAX_REQUEST_BYTES = 2 * 1024 * 1024;
var SYNC_MAX_BODY_BYTES = 1536 * 1024;
var SYNC_MAX_BATCH_ITEMS = 5000;
var SYNC_IDEMPOTENCY_PREFIX = 'MT_SYNC_IDEM_';
var SYNC_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
var SYNC_IDEMPOTENCY_MAX_ENTRIES = 256;

var SYNC_POST_ACTIONS = {
  addTicket: 'ticket',
  updateTicket: 'ticket',
  deleteTicket: 'ticket',
  addShift: 'shift',
  updateShift: 'shift',
  deleteShift: 'shift',
  syncAll: 'system',
  syncAllTickets: 'system',
  syncAllShifts: 'system',
  clearAll: 'system'
};

var SYNC_GET_ACTIONS = {
  list: true,
  checkTicketExists: true,
  getTicketById: true,
  getEntityState: true
};


/* ---------- Входные точки ---------- */

function doPost(e) {
  try {
    var raw = e && e.postData ? String(e.postData.contents || '') : '';
    if (!raw || syncUtf8Length_(raw) > SYNC_MAX_REQUEST_BYTES) {
      return syncErrorResponse_('REQUEST_TOO_LARGE');
    }

    var envelope;
    try { envelope = JSON.parse(raw); } catch (parseError) { return syncErrorResponse_('BAD_REQUEST'); }
    var verified = syncVerifyEnvelope_(envelope, 'POST');
    if (!verified.ok) return syncErrorResponse_(verified.code);

    var data;
    try { data = JSON.parse(envelope.body); } catch (bodyError) { return syncErrorResponse_('INVALID_INPUT'); }
    var validation = syncValidatePostData_(data, envelope);
    if (!validation.ok) return syncErrorResponse_(validation.code);

    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(30000);
    } catch (lockError) {
      return syncErrorResponse_('BUSY');
    }

    try {
      var fingerprint = syncIdempotencyFingerprint_(envelope);
      var previous = syncFindIdempotentResult_(envelope.requestId, fingerprint);
      if (previous.error) return syncErrorResponse_('SERVER_ERROR');
      if (previous.conflict) return syncErrorResponse_('IDEMPOTENCY_CONFLICT');
      if (previous.result) return jsonResponse(previous.result);
      if (!syncConsumeNonce_(envelope.nonce)) return syncErrorResponse_('AUTH_FAILED');

      var result = syncExecutePost_(data, envelope);
      syncRememberIdempotentResult_(envelope.requestId, fingerprint, result);
      return jsonResponse(result);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return syncErrorResponse_('SERVER_ERROR');
  }
}

function doGet(e) {
  try {
    var p = e && e.parameter ? e.parameter : {};
    var envelope = {
      v: p.v,
      method: 'GET',
      action: p.action || 'list',
      entity: p.entity || (p.action === 'list' || !p.action ? 'system' : 'ticket'),
      id: p.id || '',
      ts: p.ts,
      nonce: p.nonce,
      requestId: '',
      body: '',
      sig: p.sig
    };
    var verified = syncVerifyEnvelope_(envelope, 'GET');
    if (!verified.ok) return syncErrorResponse_(verified.code);
    if (!SYNC_GET_ACTIONS[envelope.action]) {
      return syncErrorResponse_('INVALID_INPUT');
    }
    if (envelope.action === 'list' && envelope.entity !== 'system') return syncErrorResponse_('INVALID_INPUT');
    if ((envelope.action === 'checkTicketExists' || envelope.action === 'getTicketById') && envelope.entity !== 'ticket') return syncErrorResponse_('INVALID_INPUT');
    if (envelope.action === 'getEntityState' && envelope.entity !== 'ticket' && envelope.entity !== 'shift') return syncErrorResponse_('INVALID_INPUT');
    if (envelope.action !== 'list' && !syncValidId_(envelope.id)) {
      return syncErrorResponse_('INVALID_INPUT');
    }

    var authLock = LockService.getScriptLock();
    try {
      authLock.waitLock(5000);
    } catch (lockError) {
      return syncErrorResponse_('BUSY');
    }
    try {
      if (!syncConsumeNonce_(envelope.nonce)) return syncErrorResponse_('AUTH_FAILED');
    } finally {
      authLock.releaseLock();
    }

    return syncExecuteGet_(envelope.action, envelope.entity, envelope.id);
  } catch (err) {
    return syncErrorResponse_('SERVER_ERROR');
  }
}


/* ---------- HMAC contract / validation / responses ---------- */

function syncCanonicalRequest_(request) {
  return [
    'MT-SYNC-HMAC-V3',
    syncCanonicalField_(String(Number(request.v))),
    syncCanonicalField_(String(request.method || '').toUpperCase()),
    syncCanonicalField_(String(request.action || '')),
    syncCanonicalField_(String(request.entity || '')),
    syncCanonicalField_(String(request.id || '')),
    syncCanonicalField_(String(request.ts || '')),
    syncCanonicalField_(String(request.nonce || '')),
    syncCanonicalField_(String(request.requestId || '')),
    syncCanonicalField_(String(request.body || ''))
  ].join('\n');
}

function syncCanonicalField_(value) {
  value = String(value == null ? '' : value);
  return syncUtf8Length_(value) + ':' + value;
}

function syncUtf8Length_(value) {
  return Utilities.newBlob(String(value == null ? '' : value)).getBytes().length;
}

function syncBase64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function syncSha256Base64Url_(value) {
  return syncBase64Url_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  ));
}

function syncHmacSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty(SYNC_HMAC_PROPERTY) || '');
}

function syncExpectedSignature_(canonical) {
  var secret = syncHmacSecret_();
  if (syncUtf8Length_(secret) < 32) return '';
  return syncBase64Url_(Utilities.computeHmacSha256Signature(
    String(canonical),
    secret,
    Utilities.Charset.UTF_8
  ));
}

function syncConstantTimeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  var max = Math.max(a.length, b.length);
  var diff = a.length ^ b.length;
  for (var i = 0; i < max; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

function syncVerifyEnvelope_(envelope, expectedMethod) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return {ok:false, code:'BAD_REQUEST'};
  if (Number(envelope.v) !== SYNC_PROTOCOL_VERSION) return {ok:false, code:'AUTH_FAILED'};
  if (String(envelope.method || '').toUpperCase() !== expectedMethod) return {ok:false, code:'AUTH_FAILED'};
  if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(String(envelope.action || ''))) return {ok:false, code:'AUTH_FAILED'};
  if (!/^(ticket|shift|system)$/.test(String(envelope.entity || ''))) return {ok:false, code:'AUTH_FAILED'};
  if (!/^\d{13}$/.test(String(envelope.ts || ''))) return {ok:false, code:'AUTH_FAILED'};
  if (Math.abs(Date.now() - Number(envelope.ts)) > SYNC_MAX_CLOCK_SKEW_MS) return {ok:false, code:'AUTH_FAILED'};
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(String(envelope.nonce || ''))) return {ok:false, code:'AUTH_FAILED'};
  if (expectedMethod === 'POST' && !/^[A-Za-z0-9._:-]{16,128}$/.test(String(envelope.requestId || ''))) {
    return {ok:false, code:'AUTH_FAILED'};
  }
  if (expectedMethod === 'GET' && String(envelope.requestId || '') !== '') return {ok:false, code:'AUTH_FAILED'};
  if (syncUtf8Length_(String(envelope.body || '')) > SYNC_MAX_BODY_BYTES) return {ok:false, code:'REQUEST_TOO_LARGE'};
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(envelope.sig || ''))) return {ok:false, code:'AUTH_FAILED'};
  var expected = syncExpectedSignature_(syncCanonicalRequest_(envelope));
  if (!expected || !syncConstantTimeEqual_(expected, envelope.sig)) return {ok:false, code:'AUTH_FAILED'};
  return {ok:true};
}

function syncConsumeNonce_(nonce) {
  var cache = CacheService.getScriptCache();
  var key = 'mt-sync-nonce-' + syncSha256Base64Url_(nonce);
  if (cache.get(key)) return false;
  cache.put(key, '1', SYNC_NONCE_TTL_SECONDS);
  return true;
}

function syncValidatePostData_(data, envelope) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {ok:false, code:'INVALID_INPUT'};
  if (syncHasUnsafeKeys_(data, 0)) return {ok:false, code:'INVALID_INPUT'};
  if (!SYNC_POST_ACTIONS[envelope.action] || SYNC_POST_ACTIONS[envelope.action] !== envelope.entity) return {ok:false, code:'INVALID_INPUT'};
  if (data.action !== envelope.action) return {ok:false, code:'INVALID_INPUT'};
  if (envelope.entity !== 'system') {
    if (!syncValidId_(envelope.id) || String(data.id || '') !== String(envelope.id)) return {ok:false, code:'INVALID_INPUT'};
    if (!Number.isSafeInteger(Number(data.revision)) || Number(data.revision) < 1) return {ok:false, code:'INVALID_INPUT'};
  } else if (String(envelope.id || '') !== '') {
    return {ok:false, code:'INVALID_INPUT'};
  }

  if (/Ticket$/.test(envelope.action) && envelope.action !== 'deleteTicket' && !syncValidTicket_(data)) return {ok:false, code:'INVALID_INPUT'};
  if ((envelope.action === 'addShift' || envelope.action === 'updateShift') && !syncValidShift_(data)) return {ok:false, code:'INVALID_INPUT'};
  if (envelope.action === 'syncAll' || envelope.action === 'syncAllTickets') {
    if (!syncValidTicketArray_(data.tickets || [])) return {ok:false, code:'INVALID_INPUT'};
  }
  if (envelope.action === 'syncAll' || envelope.action === 'syncAllShifts') {
    if (!syncValidShiftArray_(data.shifts || [])) return {ok:false, code:'INVALID_INPUT'};
  }
  return {ok:true};
}

function syncValidId_(value) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(String(value || ''));
}

function syncBoundedString_(value, max) {
  return value === null || value === undefined || (typeof value === 'string' && syncUtf8Length_(value) <= max);
}

function syncValidTicket_(t) {
  if (!syncValidId_(t.id)) return false;
  if (!syncValidDate_(t.date) || !syncValidTime_(t.time)) return false;
  if (!syncBoundedString_(t.content, 50000) || !syncBoundedString_(t.backupNote, 20000)) return false;
  if (!syncBoundedString_(t.fullDataJson, 300000)) return false;
  if (!Number.isFinite(Number(t.sum)) || Math.abs(Number(t.sum)) > 100000000) return false;
  if (t.tags !== undefined && (!Array.isArray(t.tags) || t.tags.length > 50)) return false;
  if (Array.isArray(t.tags) && t.tags.some(function(tag){ return typeof tag !== 'string' || syncUtf8Length_(tag) > 200; })) return false;
  return true;
}

function syncValidShift_(s) {
  return syncValidId_(s.id) && syncValidDate_(s.date) &&
    Number.isFinite(Number(s.hours)) && Number(s.hours) >= 0 && Number(s.hours) <= 48 &&
    syncBoundedString_(s.coworker, 500);
}

function syncValidDate_(value) {
  var match = String(value || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return false;
  var parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return parsed.getFullYear() === Number(match[3]) && parsed.getMonth() === Number(match[2]) - 1 && parsed.getDate() === Number(match[1]);
}

function syncValidTime_(value) {
  var match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  return !!match && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function syncHasUnsafeKeys_(value, depth) {
  if (depth > 8) return true;
  if (!value || typeof value !== 'object') return false;
  var keys = Object.keys(value);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === '__proto__' || keys[i] === 'prototype' || keys[i] === 'constructor') return true;
    if (syncHasUnsafeKeys_(value[keys[i]], depth + 1)) return true;
  }
  return false;
}

function syncValidTicketArray_(items) {
  return Array.isArray(items) && items.length <= SYNC_MAX_BATCH_ITEMS && items.every(syncValidTicket_);
}

function syncValidShiftArray_(items) {
  return Array.isArray(items) && items.length <= SYNC_MAX_BATCH_ITEMS && items.every(syncValidShift_);
}

function syncExecutePost_(data, envelope) {
  if (envelope.entity !== 'system') return syncExecuteEntityMutation_(syncSpreadsheetForEntity_(envelope.entity), data, envelope);
  // Full replacement needs an explicit recovery protocol that preserves
  // revisions and tombstones. Incremental sync must not wait for it.
  return {status:'error', code:'ADMIN_RECOVERY_REQUIRED'};
}

function syncExecuteGet_(action, entity, id) {
  if (action === 'getEntityState') return jsonResponse({status:'ok', state:syncReadEntityState_(syncSpreadsheetForEntity_(entity), entity, id)});
  if (action === 'checkTicketExists') return jsonResponse({status:'ok', exists:syncTicketExists_(id)});
  if (action === 'getTicketById') return jsonResponse({status:'ok', ticket:syncReadTicketById_(id)});
  return jsonResponse(syncReadAll_());
}

function syncTicketSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Ticket workbook is unavailable');
  return ss;
}

function syncShiftSpreadsheet_() {
  var id = String(PropertiesService.getScriptProperties().getProperty(SYNC_SHIFTS_SPREADSHEET_PROPERTY) || '').trim();
  if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) throw new Error('Shift workbook is not configured');
  var ticketSs = syncTicketSpreadsheet_();
  if (typeof ticketSs.getId === 'function' && String(ticketSs.getId()) === id) throw new Error('Shift workbook must be separate');
  var shiftSs = SpreadsheetApp.openById(id);
  if (!shiftSs) throw new Error('Shift workbook is unavailable');
  return shiftSs;
}

function syncSpreadsheetForEntity_(entity) {
  if (entity === 'ticket') return syncTicketSpreadsheet_();
  if (entity === 'shift') return syncShiftSpreadsheet_();
  throw new Error('Unsupported entity workbook');
}

function syncExecuteEntityMutation_(ss, data, envelope) {
  var revision = Number(data.revision);
  var fingerprint = syncSemanticFingerprint_(envelope.entity, envelope.id, envelope.action, revision, envelope.body);
  var current = syncReadEntityState_(ss, envelope.entity, envelope.id);

  if (revision < current.revision) return syncMutationResult_(envelope, 'STALE', current);
  if (revision === current.revision) {
    if (current.fingerprint === fingerprint) return syncMutationResult_(envelope, 'IDEMPOTENT_SUCCESS', current);
    return {status:'error', code:'CONFLICT', state:current};
  }
  if (revision !== current.revision + 1) return {status:'error', code:'REVISION_GAP', state:current};
  if (current.tombstone && envelope.action !== 'deleteTicket' && envelope.action !== 'deleteShift') {
    return {status:'error', code:'TOMBSTONED', state:current};
  }

  if (envelope.action === 'addTicket') addTicketRow(ss, data);
  else if (envelope.action === 'updateTicket') updateTicketRow(ss, data);
  else if (envelope.action === 'deleteTicket') deleteRowById(getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS), data.id);
  else if (envelope.action === 'addShift' || envelope.action === 'updateShift') {
    addShiftRow(ss, data);
    refreshShiftReport_(ss);
  }
  else if (envelope.action === 'deleteShift') {
    deleteRowById(syncGetCanonicalShiftSheet_(ss), data.id);
    refreshShiftReport_(ss);
  }

  var next = {
    entityType:envelope.entity,
    entityId:String(envelope.id),
    revision:revision,
    tombstone:envelope.action === 'deleteTicket' || envelope.action === 'deleteShift',
    fingerprint:fingerprint,
    requestId:String(envelope.requestId),
    updatedAt:new Date().toISOString()
  };
  syncWriteEntityState_(ss, next, current.rowIndex);
  return syncMutationResult_(envelope, 'APPLIED', next);
}

function syncSemanticFingerprint_(entity, id, action, revision, body) {
  return syncSha256Base64Url_([entity, id, action, String(revision), body].map(syncCanonicalField_).join('\n'));
}

function syncMutationResult_(envelope, outcome, state) {
  return {status:'ok', outcome:outcome, action:envelope.action, id:String(envelope.id), requestId:envelope.requestId, state:syncPublicEntityState_(state)};
}

function syncPublicEntityState_(state) {
  return {exists:state.revision > 0 && !state.tombstone, revision:Number(state.revision) || 0, tombstone:!!state.tombstone, fingerprint:String(state.fingerprint || '')};
}

function syncGetStateSheet_(ss, create) {
  var sheet = ss.getSheetByName(SYNC_STATE_SHEET);
  if (!sheet && create) {
    sheet = ss.insertSheet(SYNC_STATE_SHEET);
    sheet.appendRow(SYNC_STATE_HEADERS);
    sheet.hideSheet();
  }
  return sheet;
}

function syncReadEntityState_(ss, entityType, entityId) {
  var empty = {entityType:entityType, entityId:String(entityId), revision:0, tombstone:false, fingerprint:'', requestId:'', updatedAt:'', rowIndex:-1};
  var sheet = syncGetStateSheet_(ss, false);
  if (!sheet || sheet.getLastRow() <= 1) return empty;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, SYNC_STATE_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(entityType) || String(rows[i][1]) !== String(entityId)) continue;
    return {entityType:String(rows[i][0]), entityId:String(rows[i][1]), revision:Number(rows[i][2]) || 0, tombstone:rows[i][3] === true || String(rows[i][3]).toLowerCase() === 'true', fingerprint:String(rows[i][4] || ''), requestId:String(rows[i][5] || ''), updatedAt:String(rows[i][6] || ''), rowIndex:i + 2};
  }
  return empty;
}

function syncWriteEntityState_(ss, state, rowIndex) {
  var sheet = syncGetStateSheet_(ss, true);
  var row = [state.entityType, state.entityId, state.revision, state.tombstone, state.fingerprint, state.requestId, state.updatedAt];
  if (rowIndex > 1) sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  else sheet.appendRow(row);
}

function syncTicketExists_(id) {
  var sheet = syncTicketSpreadsheet_().getSheetByName('Заявки');
  if (!sheet || sheet.getLastRow() <= 1) return false;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  return ids.some(function(row){ return String(row[0]) === String(id); });
}

function syncReadTicketById_(id) {
  var ss = syncTicketSpreadsheet_();
  var sheet = ss.getSheetByName('Заявки');
  if (!sheet || sheet.getLastRow() <= 1) return null;
  var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  var rowIndex = -1;
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { rowIndex = i + 2; break; }
  if (rowIndex < 0) return null;
  var row = sheet.getRange(rowIndex, 1, 1, 8).getValues()[0];
  return syncTicketFromRow_(row, ss.getSpreadsheetTimeZone());
}

function syncReadAll_() {
  var ticketSs = syncTicketSpreadsheet_();
  var shiftSs = syncShiftSpreadsheet_();
  var ticketTz = ticketSs.getSpreadsheetTimeZone();
  var shiftTz = shiftSs.getSpreadsheetTimeZone();
  var tSheet = ticketSs.getSheetByName('Заявки');
  var sSheet = syncGetCanonicalShiftSheet_(shiftSs);
  var tickets = [];
  var shifts = [];
  if (tSheet && tSheet.getLastRow() > 1) {
    tSheet.getRange(2, 1, tSheet.getLastRow() - 1, 8).getValues().forEach(function(row){
      if (row[0] || row[1]) tickets.push(syncTicketFromRow_(row, ticketTz));
    });
  }
  if (sSheet && sSheet.getLastRow() > 1) {
    sSheet.getRange(2, 1, sSheet.getLastRow() - 1, 4).getValues().forEach(function(row){
      if (row[0] || row[1]) shifts.push({id:safeString(row[0]), date:cellToDateString(row[1], shiftTz), hours:safeNumber(row[2]), coworker:safeString(row[3])});
    });
  }
  return {status:'ok', tickets:tickets, shifts:shifts};
}

function syncTicketFromRow_(row, tz) {
  return {
    id:safeString(row[0]), date:cellToDateString(row[1], tz), time:cellToTimeString(row[2], tz),
    content:row[3] == null ? '' : String(row[3]), sum:safeNumber(row[4]),
    tags:row[5] ? String(row[5]).split(',').map(function(value){ return value.trim(); }).filter(Boolean) : [],
    backupNote:safeString(row[6]), fullDataJson:safeString(row[7]), photo:null
  };
}

function syncFindIdempotentResult_(requestId, fingerprint) {
  var raw = PropertiesService.getScriptProperties().getProperty(syncIdempotencyKey_(requestId));
  if (!raw) return {};
  var entry;
  try { entry = JSON.parse(raw); } catch (err) { return {error:true}; }
  if (!entry || entry.id !== requestId || !entry.result || Number(entry.at) < Date.now() - SYNC_IDEMPOTENCY_TTL_MS) return {};
  if (entry.fingerprint !== fingerprint) return {conflict:true};
  return {result:entry.result};
}

function syncIdempotencyFingerprint_(envelope) {
  return syncSha256Base64Url_([
    String(envelope.v), String(envelope.method), String(envelope.action),
    String(envelope.entity), String(envelope.id || ''), String(envelope.body || '')
  ].map(syncCanonicalField_).join('\n'));
}

function syncRememberIdempotentResult_(requestId, fingerprint, result) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(syncIdempotencyKey_(requestId), JSON.stringify({
    id:requestId, fingerprint:fingerprint, at:Date.now(), result:result
  }));
  syncCleanupIdempotency_(props);
}

function syncIdempotencyKey_(requestId) {
  return SYNC_IDEMPOTENCY_PREFIX + syncSha256Base64Url_(requestId);
}

function syncCleanupIdempotency_(props) {
  var all = props.getProperties();
  var entries = [];
  var cutoff = Date.now() - SYNC_IDEMPOTENCY_TTL_MS;
  Object.keys(all).forEach(function(key){
    if (key.indexOf(SYNC_IDEMPOTENCY_PREFIX) !== 0) return;
    var entry;
    try { entry = JSON.parse(all[key]); } catch (err) { props.deleteProperty(key); return; }
    if (!entry || Number(entry.at) < cutoff) { props.deleteProperty(key); return; }
    entries.push({key:key, at:Number(entry.at)});
  });
  entries.sort(function(a, b){ return b.at - a.at; });
  entries.slice(SYNC_IDEMPOTENCY_MAX_ENTRIES).forEach(function(entry){ props.deleteProperty(entry.key); });
}

function syncErrorResponse_(code) {
  var publicCode = /^(AUTH_FAILED|BAD_REQUEST|REQUEST_TOO_LARGE|INVALID_INPUT|BUSY|IDEMPOTENCY_CONFLICT|CONFLICT|REVISION_GAP|TOMBSTONED|ADMIN_RECOVERY_REQUIRED|SERVER_ERROR)$/.test(String(code)) ? String(code) : 'SERVER_ERROR';
  return jsonResponse({status:'error', code:publicCode});
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* ---------- Листы и заголовки ---------- */

function getOrCreateSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);

  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }

  sheet.getRange(1, 1, 1000, 3).setNumberFormat('@');

  if (name === 'Заявки') {
    sheet.getRange(1, 6, 1000, 3).setNumberFormat('@');
    sheet
      .getRange(1, 4, Math.max(sheet.getMaxRows(), 1000), 1)
      .setWrap(true);
  }

  return sheet;
}


/* ---------- Заявки ---------- */

function addTicketRow(ss, t) {
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  var last = sheet.getLastRow();

  if (last > 1) {
    var ids = sheet
      .getRange(2, 1, last - 1, 1)
      .getValues()
      .flat();

    var existingIndex = ids.findIndex(function (v) { return String(v) === String(t.id); });
    if (existingIndex !== -1) {
      writeTicketRow(sheet, existingIndex + 2, t);
      sortTicketsSheet(sheet);
      return;
    }
  }

  var newKey = ticketDateKey(t);
  var insertRow = last + 1;

  if (last > 1) {
    var dateTimeCols = sheet.getRange(2, 2, last - 1, 2).getValues();

    for (var i = 0; i < dateTimeCols.length; i++) {
      var existingKey = rowDateKey([
        null,
        dateTimeCols[i][0],
        dateTimeCols[i][1]
      ]);

      if (existingKey < newKey) {
        insertRow = i + 2;
        break;
      }
    }
  }

  if (insertRow <= last) sheet.insertRowBefore(insertRow);
  writeTicketRow(sheet, insertRow, t);
}

/*
  Безопасное обновление по стабильному ID.
  Нет опасного промежутка delete → add.
*/
function updateTicketRow(ss, t) {
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  var last = sheet.getLastRow();

  if (last < 2) {
    addTicketRow(ss, t);
    return;
  }

  var ids = sheet
    .getRange(2, 1, last - 1, 1)
    .getValues()
    .flat();

  var idx = ids.findIndex(function (v) {
    return String(v) === String(t.id);
  });

  /*
    Если строки нет, например прошлое создание не дошло до сервера,
    создаём её безопасно обычным путём.
  */
  if (idx === -1) {
    addTicketRow(ss, t);
    return;
  }

  writeTicketRow(sheet, idx + 2, t);
  sortTicketsSheet(sheet);
}

function writeTicketRow(sheet, rowIndex, t) {
  var row = [
    t.id,
    t.date,
    t.time,
    t.content,
    t.sum,
    (t.tags || []).join(', '),
    t.backupNote || '',
    t.fullDataJson || ''
  ];

  var range = sheet.getRange(rowIndex, 1, 1, row.length);

  sheet.getRange(rowIndex, 1, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 2, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 3, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 5, 1, 1).setNumberFormat('0.##');
  sheet.getRange(rowIndex, 6, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 7, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 8, 1, 1).setNumberFormat('@');

  range.setValues([row]);
  sheet.getRange(rowIndex, 4, 1, 1).setWrap(true);
  sheet.autoResizeRows(rowIndex, 1);
}

function writeAllTickets(ss, tickets) {
  var sorted = sortTicketsByDateDesc(tickets);
  var tempSheet = ss.insertSheet('_Заявки_tmp_' + Date.now());

  try {
    tempSheet.appendRow(TICKET_HEADERS);

    if (sorted.length) {
      var rows = sorted.map(function (t) {
        return [
          t.id,
          t.date,
          t.time,
          t.content,
          t.sum,
          (t.tags || []).join(', '),
          t.backupNote || '',
          t.fullDataJson || ''
        ];
      });

      tempSheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 2, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 3, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 5, rows.length, 1).setNumberFormat('0.##');
      tempSheet.getRange(2, 6, rows.length, 3).setNumberFormat('@');
      tempSheet.getRange(2, 1, rows.length, 8).setValues(rows);
      tempSheet.getRange(2, 4, rows.length, 1).setWrap(true);
    }

    swapInPlace(ss, tempSheet, 'Заявки');
    getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  } catch (err) {
    ss.deleteSheet(tempSheet);
    throw err;
  }
}

function swapInPlace(ss, newSheet, finalName) {
  var oldSheet = ss.getSheetByName(finalName);

  if (oldSheet) {
    oldSheet.setName('_' + finalName + '_old_' + Date.now());
  }

  newSheet.setName(finalName);

  if (oldSheet) {
    ss.deleteSheet(oldSheet);
  }
}

function sortTicketsSheet(sheet) {
  var last = sheet.getLastRow();
  if (last <= 2) return;

  var range = sheet.getRange(
    2,
    1,
    last - 1,
    TICKET_HEADERS.length
  );

  var rows = range.getValues();

  rows.sort(function (a, b) {
    return rowDateKey(b) - rowDateKey(a);
  });

  range.setValues(rows);
}

function sortTicketsByDateDesc(list) {
  return (list || []).slice().sort(function (a, b) {
    return ticketDateKey(b) - ticketDateKey(a);
  });
}

function rowDateKey(row) {
  var d = parseDdMmYyyy(row[1]);
  if (!d) return 0;
  return d.getTime() + timeToMs(row[2]);
}

function ticketDateKey(t) {
  var d = parseDdMmYyyy(t.date);
  if (!d) return 0;
  return d.getTime() + timeToMs(t.time);
}

function sortExistingTicketsNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet(ss, 'Заявки', TICKET_HEADERS);
  sortTicketsSheet(sheet);
}


/* ---------- Смены ---------- */

function syncGetCanonicalShiftSheet_(ss) {
  var sheet = ss.getSheetByName(SHIFT_STORAGE_SHEET);
  if (!sheet) throw new Error('Canonical shift storage is missing');

  var lastColumn = typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : SHIFT_HEADERS.length;
  var width = Math.max(SHIFT_HEADERS.length, lastColumn);
  var header = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];

  for (var i = 0; i < SHIFT_HEADERS.length; i++) {
    if (String(header[i] || '').trim() !== SHIFT_HEADERS[i]) throw new Error('Canonical shift storage schema mismatch');
  }
  for (var extra = SHIFT_HEADERS.length; extra < header.length; extra++) {
    if (String(header[extra] || '').trim()) throw new Error('Canonical shift storage schema mismatch');
  }

  return sheet;
}

function addShiftRow(ss, s) {
  var sheet = syncGetCanonicalShiftSheet_(ss);
  var newDate = parseDdMmYyyy(s.date);
  var last = sheet.getLastRow();
  var insertRow = last + 1;

  if (last > 1) {
    var ids = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
    for (var existingIndex = 0; existingIndex < ids.length; existingIndex++) {
      if (String(ids[existingIndex][0]) === String(s.id)) {
        writeShiftRow(sheet, existingIndex + 2, s);
        return;
      }
    }
  }

  if (newDate && last > 1) {
    var dates = sheet.getRange(2, 2, last - 1, 1).getValues();

    for (var i = 0; i < dates.length; i++) {
      var existing = parseDdMmYyyy(dates[i][0]);

      if (existing && existing > newDate) {
        insertRow = i + 2;
        break;
      }
    }
  }

  if (insertRow <= last) sheet.insertRowBefore(insertRow);
  writeShiftRow(sheet, insertRow, s);
}

function writeShiftRow(sheet, rowIndex, s) {
  var row = [s.id, s.date, s.hours, s.coworker];
  var range = sheet.getRange(rowIndex, 1, 1, row.length);

  sheet.getRange(rowIndex, 1, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 2, 1, 1).setNumberFormat('@');
  sheet.getRange(rowIndex, 3, 1, 1).setNumberFormat('0.##');
  sheet.getRange(rowIndex, 4, 1, 1).setNumberFormat('@');

  range.setValues([row]);
}

function writeAllShifts(ss, shifts) {
  var list = shifts || [];
  var tempSheet = ss.insertSheet(SHIFT_STORAGE_SHEET + '_tmp_' + Date.now());

  try {
    tempSheet.appendRow(SHIFT_HEADERS);

    if (list.length) {
      var rows = list.map(function (s) {
        return [s.id, s.date, s.hours, s.coworker];
      });

      tempSheet.getRange(2, 1, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 2, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 3, rows.length, 1).setNumberFormat('0.##');
      tempSheet.getRange(2, 4, rows.length, 1).setNumberFormat('@');
      tempSheet.getRange(2, 1, rows.length, 4).setValues(rows);
    }

    swapInPlace(ss, tempSheet, SHIFT_STORAGE_SHEET);
    syncGetCanonicalShiftSheet_(ss);
    refreshShiftReport_(ss);
  } catch (err) {
    ss.deleteSheet(tempSheet);
    throw err;
  }
}

function refreshShiftReport_(ss) {
  var storage = syncGetCanonicalShiftSheet_(ss);
  var tz = ss.getSpreadsheetTimeZone();
  var shifts = [];

  if (storage.getLastRow() > 1) {
    storage.getRange(2, 1, storage.getLastRow() - 1, SHIFT_HEADERS.length).getValues().forEach(function (row) {
      if (!row[0] && !row[1]) return;
      shifts.push({
        id:safeString(row[0]),
        date:cellToDateString(row[1], tz),
        hours:safeNumber(row[2]),
        coworker:safeString(row[3])
      });
    });
  }

  var rows = buildShiftReportRows_(shifts);
  var report = ss.getSheetByName(SHIFT_REPORT_SHEET) || ss.insertSheet(SHIFT_REPORT_SHEET);
  var clearRows = Math.max(report.getLastRow(), rows.length, 1);
  var reportRange = report.getRange(1, 1, clearRows, 5);
  if (typeof reportRange.breakApart === 'function') reportRange.breakApart();
  reportRange.clearContent();
  reportRange.setBackground(null);
  reportRange.setFontWeight('normal');
  reportRange.setBorder(false, false, false, false, false, false);

  if (rows.length) {
    report.getRange(1, 1, rows.length, 5).setValues(rows);
    report.getRange(1, 1, rows.length, 2).setNumberFormat('@');
    report.getRange(1, 3, rows.length, 1).setNumberFormat('0.##');
    report.getRange(1, 4, rows.length, 2).setNumberFormat('@');
    formatShiftReport_(report, rows);
    formatShiftReportBorders_(report, rows);
  }
}

function formatShiftReport_(report, rows) {
  (rows || []).forEach(function (row, index) {
    var first = String(row && row[0] || '');
    var range = report.getRange(index + 1, 1, 1, 4);

    if (first.indexOf('📅 МІСЯЦЬ: ') === 0) {
      range.setBackground('#d9ead3').setFontWeight('bold');
      return;
    }
    if (first === 'Дата') {
      range.setBackground('#e2e3e5').setFontWeight('bold');
      return;
    }
    if (first === '📊 РАЗОМ ЗА МІСЯЦЬ:') {
      range.setBackground('#fff2cc').setFontWeight('bold');
      return;
    }

    var weekColor = shiftReportWeekColor_(first);
    if (weekColor) range.setBackground(weekColor).setFontWeight('normal');
  });
}

function shiftReportWeekColor_(dateValue) {
  var date = parseDdMmYyyy(dateValue);
  if (!date) return '';

  var dayUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  var weekdayFromMonday = (new Date(dayUtc).getUTCDay() + 6) % 7;
  var mondayUtc = dayUtc - weekdayFromMonday * 24 * 60 * 60 * 1000;
  var absoluteWeek = Math.floor(mondayUtc / (7 * 24 * 60 * 60 * 1000));
  var colors = ['#f3f4f6', '#eaf3ff', '#edf7ed'];
  var colorIndex = ((absoluteWeek % colors.length) + colors.length) % colors.length;
  return colors[colorIndex];
}

function formatShiftReportBorders_(report, rows) {
  var blockStart = 0;
  var medium = SpreadsheetApp.BorderStyle.SOLID_MEDIUM;
  var solid = SpreadsheetApp.BorderStyle.SOLID;

  (rows || []).forEach(function (row, index) {
    var first = String(row && row[0] || '');
    if (first.indexOf('📅 МІСЯЦЬ: ') === 0) blockStart = index + 1;
    if (first !== '📊 РАЗОМ ЗА МІСЯЦЬ:' || !blockStart) return;

    var blockRows = index + 2 - blockStart;
    var blockRange = report.getRange(blockStart, 1, blockRows, 4);
    blockRange
      .setBorder(false, false, false, false, false, false)
      .setBorder(null, null, null, null, true, true, '#d9d9d9', solid)
      .setBorder(true, true, true, true, null, null, '#000000', medium);
    report.getRange(blockStart, 1, blockRows, 1)
      .setBorder(null, true, null, null, null, null, '#000000', medium);
    blockStart = 0;
  });
}

function buildShiftReportRows_(shifts) {
  var weekdays = ['нд','пн','вт','ср','чт','пт','сб'];
  var groups = {};

  (shifts || []).forEach(function (shift) {
    var date = parseDdMmYyyy(shift.date);
    if (!date) throw new Error('Canonical shift storage contains invalid date');
    var key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    if (!groups[key]) groups[key] = [];
    groups[key].push({shift:shift, date:date});
  });

  var rows = [];
  Object.keys(groups).sort().reverse().forEach(function (key, groupIndex) {
    if (groupIndex) rows.push(['','','','','']);
    rows.push(['📅 МІСЯЦЬ: ' + key,'','','','']);
    rows.push(['Дата','День','Години','Напарник','']);

    var hours = 0;
    groups[key].sort(function (a, b) {
      return a.date.getTime() - b.date.getTime() || String(a.shift.id).localeCompare(String(b.shift.id));
    }).forEach(function (entry) {
      var shiftHours = safeNumber(entry.shift.hours);
      hours += shiftHours;
      rows.push([entry.shift.date, weekdays[entry.date.getDay()], shiftHours, safeString(entry.shift.coworker), safeString(entry.shift.id)]);
    });

    rows.push(['📊 РАЗОМ ЗА МІСЯЦЬ:','',hours,groups[key].length + ' упряжок','']);
  });

  return rows;
}


/* ---------- Общие функции ---------- */

function deleteRowById(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return;

  var ids = sheet
    .getRange(2, 1, last - 1, 1)
    .getValues()
    .flat();

  var idx = ids.findIndex(function (v) {
    return String(v) === String(id);
  });

  if (idx > -1) {
    sheet.deleteRow(idx + 2);
  }
}

function syncAllData(ss, tickets, shifts) {
  writeAllTickets(ss, tickets || []);
  writeAllShifts(ss, shifts || []);
}


/* ---------- Форматирование ---------- */

function parseDdMmYyyy(s) {
  if (s instanceof Date) {
    return isNaN(s.getTime()) ? null : s;
  }

  var parts = String(s || '').split('.');
  if (parts.length !== 3) return null;

  var d = new Date(
    Number(parts[2]),
    Number(parts[1]) - 1,
    Number(parts[0])
  );

  return isNaN(d.getTime()) ? null : d;
}

function timeToMs(t) {
  if (t instanceof Date) {
    return (t.getHours() * 60 + t.getMinutes()) * 60000;
  }

  var m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;

  return (Number(m[1]) * 60 + Number(m[2])) * 60000;
}

function cellToDateString(v, tz) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, tz, 'dd.MM.yyyy');
  }

  return v === null || v === undefined ? '' : String(v).trim();
}

function cellToTimeString(v, tz) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, tz, 'HH:mm');
  }

  return v === null || v === undefined ? '' : String(v).trim();
}

function safeString(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function safeNumber(v) {
  if (v instanceof Date) return 0;

  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

