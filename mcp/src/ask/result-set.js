import {validateTicketId} from './ticket-id.js';

export const RESULT_SET_VERSION = 1;
export const RESULT_SET_TTL_MS = 12 * 60 * 60 * 1000;
export const RESULT_SET_HARD_MAX_ITEMS = 100;
/* Leaves room below /ask's 32768-character request limit for the current
   question, eight 1500-char history messages, queryContext and envelope. */
export const RESULT_SET_CONTEXT_CHAR_BUDGET = 13500;

function isObject(value){
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resultSetId(){
  try{
    if(globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  }catch(_err){}
  return 'rs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
}

export function validChatSessionId(value){
  const id = String(value == null ? '' : value).trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(id) ? id : null;
}

export function sanitizeIncomingResultSet(raw, chatSessionId, nowMs){
  if(!isObject(raw)) return {ok:false, code:'NO_ACTIVE_RESULT_SET'};
  const session = validChatSessionId(chatSessionId);
  const bound = validChatSessionId(raw.chatSessionId);
  if(!session || !bound || session !== bound) return {ok:false, code:'SESSION_MISMATCH'};
  if(Number(raw.version) !== RESULT_SET_VERSION) return {ok:false, code:'NO_ACTIVE_RESULT_SET'};
  const createdAt = Number(raw.createdAt), expiresAt = Number(raw.expiresAt);
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  if(!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || expiresAt <= createdAt ||
     expiresAt - createdAt > RESULT_SET_TTL_MS || createdAt > now + 5 * 60 * 1000){
    return {ok:false, code:'NO_ACTIVE_RESULT_SET'};
  }
  if(now >= expiresAt) return {ok:false, code:'EXPIRED'};
  if(!Array.isArray(raw.ticketIds) || !raw.ticketIds.length || raw.ticketIds.length > RESULT_SET_HARD_MAX_ITEMS){
    return {ok:false, code:'NO_ACTIVE_RESULT_SET'};
  }
  const ticketIds = [];
  for(const value of raw.ticketIds){
    const id = validateTicketId(value);
    if(!id) return {ok:false, code:'INVALID_TICKET_ID'};
    ticketIds.push(id);
  }
  return {ok:true, value:{
    version:RESULT_SET_VERSION,
    id:String(raw.id == null ? '' : raw.id).slice(0, 128),
    chatSessionId:session,
    createdAt,
    expiresAt,
    total:Math.max(0, Number(raw.total) || 0),
    ticketIds
  }};
}

function safePreview(row, index, id){
  const text = function(value, max){ return String(value == null ? '' : value).trim().slice(0, max); };
  const address = [text(row.city, 80), [text(row.street, 100), text(row.house, 16)].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ').slice(0, 200);
  return {
    index:index,
    ticket_id:id,
    date:text(row.date, 32),
    time:text(row.time, 16),
    address:address || text(row.address, 200),
    type:text(row.type, 100),
    sum:(typeof row.sum === 'number' && Number.isFinite(row.sum)) ? String(Math.round(row.sum * 100) / 100) : text(row.sum, 16),
    signal:text(row.signal, 32)
  };
}

export function createResultSet(rows, total, chatSessionId, nowMs){
  const session = validChatSessionId(chatSessionId);
  if(!session || !Array.isArray(rows)) return null;
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const ticketIds = [], items = [], seen = new Set();
  let skippedInvalid = 0;
  for(const row of rows){
    if(ticketIds.length >= RESULT_SET_HARD_MAX_ITEMS) break;
    const id = validateTicketId(row && row.id);
    if(!id){ skippedInvalid++; continue; }
    if(seen.has(id)) continue;
    const tentative = ticketIds.concat(id);
    const probe = {
      version:RESULT_SET_VERSION, id:'x'.repeat(36), chatSessionId:session,
      createdAt:now, expiresAt:now + RESULT_SET_TTL_MS,
      total:Math.max(0, Number(total) || rows.length), ticketIds:tentative
    };
    if(JSON.stringify(probe).length > RESULT_SET_CONTEXT_CHAR_BUDGET) break;
    seen.add(id);
    ticketIds.push(id);
    items.push(safePreview(row, ticketIds.length, id));
  }
  if(!ticketIds.length) return {resultSet:null, items:[], skippedInvalid};
  return {
    resultSet:{
      version:RESULT_SET_VERSION,
      id:resultSetId(),
      chatSessionId:session,
      createdAt:now,
      expiresAt:now + RESULT_SET_TTL_MS,
      total:Math.max(0, Number(total) || rows.length),
      ticketIds
    },
    items,
    skippedInvalid
  };
}
