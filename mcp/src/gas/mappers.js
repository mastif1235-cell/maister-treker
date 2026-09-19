/* Mapper + REDACTION layer between raw GAS row payloads and MCP tool output.

   Security model: a strict WHITELIST projection. Only the fields listed in
   REDACTED_TICKET_FIELDS / REDACTED_SHIFT_FIELDS can ever reach an MCP
   client; every other key (password, login, master note, Telegram service
   fields, system secrets, raw payload columns) is dropped, even if it appears
   in a malformed or adversarial payload. On top of the whitelist,
   assertNoForbidden() walks every outgoing object and throws if a forbidden
   key name is present — defense in depth that tests exercise. */

export const DATE_RE = /^\d{2}\.\d{2}\.\d{4}$/;
export const TIME_RE = /^\d{2}:\d{2}$/;

/* Exact mirror of the app's normalizeOnuSignal (js/ticket-form-domain.js). */
export function normalizeOnuSignal(value){
  const text = String(value ?? '').trim().replace(',', '.');
  if(!text) return '';
  const number = Number(text);
  if(!Number.isFinite(number)) return '';
  return String(number);
}

/* Historical signal values were sometimes written into notes before the
   structured field existed. Only an explicit signal marker qualifies; an
   unrelated negative number in a note never becomes a signal. */
export function searchableTextFromGasRow(row, fullData){
  const f = fullData && typeof fullData === 'object' ? fullData : {};
  return [row && row.content, row && row.backupNote, f.note, f.abonentNote, f.otherNote, f.masterNote]
    .map(function(value){ return String(value == null ? '' : value).trim(); }).filter(Boolean).join('\\n');
}

export function parseLegacySignal(text){
  const source = String(text == null ? '' : text);
  const match = /(?:^|[^\p{L}])сигнал\s*(?:[:=]\s*)?(-?\d+(?:[.,]\d+)?)(?=\s*(?:d\s*bm|д\s*бм)?(?:[^\p{L}\d]|$))/iu.exec(source);
  if(!match) return '';
  const normalized = normalizeOnuSignal(match[1]);
  const number = Number(normalized);
  return Number.isFinite(number) && number >= -100 && number <= 20 ? normalized : '';
}

function firstLegacySignal(values){
  for(const value of values){
    const signal = parseLegacySignal(value);
    if(signal) return signal;
  }
  return '';
}

/* 'DD.MM.YYYY' -> 'YYYY-MM-DD' for range comparisons; null when invalid. */
export function parseDateKey(value){
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(value || ''));
  if(!m) return null;
  const day = Number(m[1]), month = Number(m[2]);
  if(month < 1 || month > 12 || day < 1 || day > 31) return null;
  return m[3] + '-' + m[2] + '-' + m[1];
}

function str(value){ return value == null ? '' : String(value); }
function num(value){ const n = Number(value); return Number.isFinite(n) ? n : 0; }
function strArray(value){
  return Array.isArray(value) ? value.map(function(item){ return item == null ? '' : String(item); }).filter(Boolean) : [];
}

/* Parse one GAS row ({id,date,time,content,sum,tags,backupNote,fullDataJson})
   into the internal structured ticket. The raw columns backupNote/fullDataJson
   are NEVER copied into the result of redact*(); they exist here only as
   sources for whitelisted fields. backupNote is dropped entirely: in the app
   it intentionally carries private markers (master's private note, login,
   a password-presence marker) that must not reach AI clients. */
export function ticketFromGasRow(row){
  const t = {
    id: str(row && row.id),
    date: str(row && row.date),
    time: str(row && row.time),
    content: str(row && row.content),
    sum: num(row && row.sum),
    tags: strArray(row && row.tags),
    fullData: {},
    fullDataError: false,
    legacySignal: firstLegacySignal([row && row.content, row && row.backupNote]),
    searchableText: ''
  };
  const raw = row && row.fullDataJson;
  if(raw != null && raw !== ''){
    let parsed = null;
    try{ parsed = JSON.parse(String(raw)); }
    catch(_err){ t.fullDataError = true; }
    if(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) t.fullData = parsed;
    else t.fullDataError = true;
  }
  if(!t.legacySignal) t.legacySignal = firstLegacySignal([
    t.fullData.note, t.fullData.abonentNote, t.fullData.otherNote, t.fullData.masterNote
  ]);
  t.searchableText = searchableTextFromGasRow(row, t.fullData);
  return t;
}

export const REDACTED_TICKET_FIELDS = [
  'id', 'date', 'time', 'type', 'city', 'street', 'house', 'apartment',
  'address', 'clientName', 'phone', 'extraPhones', 'macAddress', 'signal',
  'payment', 'sum', 'cashAmount', 'cardAmount', 'callFee', 'tariff',
  'tags', 'contractNumber', 'note', 'abonentNote', 'otherNote', 'geoLink',
  'equipment', 'cables', 'presetWorks', 'additionalWork', 'cloudImported'
];

export const REDACTED_SHIFT_FIELDS = ['id', 'date', 'hours', 'coworker'];

/* Keys that must never appear anywhere in MCP output, at any nesting depth. */
const FORBIDDEN_KEY_RE = new RegExp('^(' +
  'password|login|masterNote|backupNote|fullDataJson|photo|photos' +
  '|scriptUrl|shiftsScriptUrl' +
  '|tgBackedUp|tgBackupPending|tgPhotoFileId|tgPhotoFileIds|tgJsonMsgId|tgSepMsgId' +
  '|tgTextMsgId|tgPhotoMsgId|tgPhotoMsgIds|tgPhotoKeys|tgBackupCleanupMsgIds' +
  '|tgBackupCleanupAttempts|tgBackupStaleMsgIds|tgBackupAmbiguous' +
  '|syncHmacSecret|syncSecret|tgBotToken|tgBackupChatId|tgDispatcherChatId' +
  '|tgDispatchers|tgMyChatId|tgShiftsMsgId|mapTilerApiKey|mapTilerKey' +
  '|authorizationHeader|accessToken|refreshToken|apiToken|callbackUrl' +
  ')$', 'i');
const FORBIDDEN_SUBSTR = /secret|token|credential/i;

export function isForbiddenKey(key){
  const name = String(key || '');
  return FORBIDDEN_KEY_RE.test(name) || FORBIDDEN_SUBSTR.test(name);
}

/* Recursively verify that no forbidden key is present; throws otherwise. */
export function assertNoForbidden(value, depth){
  if(depth == null) depth = 0;
  if(depth > 24) throw new Error('FORBIDDEN_CHECK_TOO_DEEP');
  if(Array.isArray(value)){
    value.forEach(function(item){ assertNoForbidden(item, depth + 1); });
    return;
  }
  if(!value || typeof value !== 'object') return;
  for(const key of Object.keys(value)){
    if(isForbiddenKey(key)) throw new Error('FORBIDDEN_KEY:' + key);
    assertNoForbidden(value[key], depth + 1);
  }
}

function geoLinkOnly(value){
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : '';
}

/* Whitelist projection of one ticket for MCP clients. Field order is fixed
   (deterministic JSON output for identical inputs). */
export function redactTicket(t){
  const f = (t && t.fullData && typeof t.fullData === 'object' && !Array.isArray(t.fullData)) ? t.fullData : {};
  const out = {
    id: t.id,
    date: t.date,
    time: t.time,
    type: str(f.type),
    city: str(f.city),
    street: str(f.street),
    house: str(f.house),
    apartment: str(f.apartment),
    address: str(f.address),
    clientName: str(f.clientName),
    phone: str(f.phone),
    extraPhones: strArray(f.extraPhones),
    macAddress: str(f.macAddress),
    signal: normalizeOnuSignal(f.signal) || t.legacySignal || '',
    payment: str(f.payment),
    sum: num(t.sum),
    cashAmount: num(f.cashAmount),
    cardAmount: num(f.cardAmount),
    callFee: num(f.callFee),
    tariff: num(f.tariff),
    tags: t.tags.slice(),
    contractNumber: str(f.contractNumber),
    note: str(f.note),
    abonentNote: str(f.abonentNote),
    otherNote: str(f.otherNote),
    geoLink: geoLinkOnly(f.geoLink),
    equipment: Array.isArray(f.equipment) ? f.equipment.map(function(e){
      return {label: str(e && e.label), price: num(e && e.price), qty: num(e && e.qty) || 1, total: num(e && e.price) * (num(e && e.qty) || 1)};
    }).filter(function(e){ return e.label; }) : [],
    cables: Array.isArray(f.cables) ? f.cables.map(function(c){
      return {label: str(c && c.label), meters: num(c && c.meters), pricePerMeter: num(c && c.pricePerMeter)};
    }).filter(function(c){ return c.label; }) : [],
    presetWorks: Array.isArray(f.presetWorks) ? f.presetWorks.map(function(w){
      return {label: str(w && w.label), price: num(w && w.price), qty: num(w && w.qty)};
    }).filter(function(w){ return w.label; }) : [],
    additionalWork: Array.isArray(f.additionalWork) ? f.additionalWork.map(function(w){
      return {desc: str(w && w.desc), sum: num(w && w.sum)};
    }).filter(function(w){ return w.desc || w.sum; }) : [],
    cloudImported: f.cloudImported === true
  };
  assertNoForbidden(out);
  return out;
}

export function redactShift(s){
  const out = {id: str(s && s.id), date: str(s && s.date), hours: num(s && s.hours), coworker: str(s && s.coworker)};
  assertNoForbidden(out);
  return out;
}

/* ---- Search: exact mirror of the app list predicate ----
   Copied from renderMainTicketList (js/tickets-domain.js, the `q` filter) and
   ticketSignalMatchesQuery (js/ticket-form-domain.js). Parity is proven by
   tests/integration/parity.test.js against the real app modules. */
function ticketSignalMatchesQuery(ticket, query){
  const signal = normalizeOnuSignal(ticket && ticket.signal);
  return !!signal && signal.toLowerCase().includes(String(query || '').trim().toLowerCase());
}

export function ticketMatchesQuery(t, query){
  const q = String(query || '').trim().toLowerCase();
  if(!q) return true;
  const qDigits = q.replace(/\D/g, '');
  const searchable = [t.date, t.city, t.address, t.clientName, ...(t.tags || [])]
    .map(function(v){ return String(v == null ? '' : v).toLowerCase(); });
  return searchable.some(function(value){ return value.includes(q); }) ||
    ticketSignalMatchesQuery(t, q) ||
    (qDigits.length >= 3 && String(t.phone || '').replace(/\D/g, '').includes(qDigits)) ||
    (qDigits.length >= 3 && (t.extraPhones || []).some(function(p){ return String(p || '').replace(/\D/g, '').includes(qDigits); }));
}
