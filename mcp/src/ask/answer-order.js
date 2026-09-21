/* v91.60 — visible numbering IS the ordinal.
   The READ tools return rows newest-first, but the model may print the list
   in another order («В каком городе есть адрес Матроська 22» → analytics list
   the cities alphabetically, so the answer says «1. Дніпро …, 2. Таромське …»
   while the tool rows were [Таромське, Дніпро]). The referents / result set
   used to keep the HIDDEN tool order, so «открой первую карточку» opened #2.

   alignRowsToAnswer() re-orders the structured rows to the numbered list the
   user actually sees. It is strict: every item of the list must match exactly
   one row by its own facts (date, apartment, city, street, house, time), the
   mapping must be one-to-one, and any doubt keeps the original order — nothing
   is ever guessed and no row is ever dropped or invented. */

import {placeIdentity, matchScore, normalizeHouse, normalizeApartment} from './address.js';
import {validateTicketId} from './ticket-id.js';

const ITEM_RE = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const BLANK_RE = /^\s*$/;
const CONTINUATION_RE = /^(?:\s+\S|\s*(?:—|–|-|•|·)\s*\S)/;

/* Numbered runs of the answer, continuation lines merged into their item.
   A run ends at a plain text line or when the numbering restarts. */
export function numberedRuns(answer){
  const lines = String(answer == null ? '' : answer).split('\n');
  const runs = [];
  let run = [];
  const flush = function(){ if(run.length) runs.push(run); run = []; };
  for(const line of lines){
    const m = ITEM_RE.exec(line);
    if(m){
      if(run.length && Number(m[1]) <= run[run.length - 1].n) flush();
      run.push({n:Number(m[1]), text:m[2]});
      continue;
    }
    if(BLANK_RE.test(line)) continue;
    if(run.length && CONTINUATION_RE.test(line)){
      run[run.length - 1].text += ' ' + line.trim();
      continue;
    }
    flush();
  }
  flush();
  return runs;
}

function words(text){
  return String(text == null ? '' : text).toLowerCase()
    .replace(/\*\*/g, ' ')
    .replace(/[!?,;:"'«»()\[\]]+/g, ' ')
    .split(/\s+/)
    .map(function(w){ return w.replace(/^[.—–-]+|[.—–-]+$/g, ''); })
    .filter(Boolean);
}

function sameName(rowValue, candidate){
  const a = placeIdentity(rowValue), b = placeIdentity(candidate);
  if(a && b && a === b) return true;
  return matchScore(String(rowValue || ''), String(candidate || '')) >= 0.92;
}

function mentionsName(itemWords, rowValue){
  if(!String(rowValue || '').trim()) return false;
  for(let i = 0; i < itemWords.length; i++){
    for(let len = 1; len <= 3 && i + len <= itemWords.length; len++){
      if(sameName(rowValue, itemWords.slice(i, i + len).join(' '))) return true;
    }
  }
  return false;
}

function escapeRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Facts of one row against one printed item. Points are additive; the
   caller demands a clear winner. */
export function itemRowScore(itemText, row){
  const text = String(itemText || '');
  const low = text.toLowerCase();
  const itemWords = words(text);
  let score = 0;
  const date = String(row.date || '').trim();
  if(date && low.indexOf(date.toLowerCase()) !== -1) score += 4;
  else {
    const dm = /^(\d{2})\.(\d{2})\.\d{4}$/.exec(date);
    if(dm && new RegExp('(?<![\\d.])' + dm[1] + '\\.' + dm[2] + '(?![\\d])').test(low)) score += 2;
  }
  const time = String(row.time || '').trim();
  if(time && new RegExp('(?<!\\d)' + escapeRe(time) + '(?!\\d)').test(low)) score += 1;
  const apt = normalizeApartment(row.apartment);
  if(apt && new RegExp('(?:кв|квартир[аиу]|apt)\\.?\\s*' + escapeRe(apt) + '(?![\\p{L}\\p{N}])', 'iu').test(low)) score += 3;
  const house = normalizeHouse(row.house);
  if(house && itemWords.some(function(w){ return normalizeHouse(w) === house; })) score += 2;
  if(mentionsName(itemWords, row.city)) score += 2;
  if(mentionsName(itemWords, row.street)) score += 1;
  const type = String(row.type || '').trim().toLowerCase();
  if(type && low.indexOf(type) !== -1) score += 1;
  return score;
}

function uniqueRows(rows){
  const seen = new Set();
  const out = [];
  for(const row of (Array.isArray(rows) ? rows : [])){
    const id = row && typeof row === 'object' ? validateTicketId(row.id) : null;
    if(!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

/* One run → map item index → row id, or null when any item is not decided
   by a clear margin or two items claim the same row. */
function resolveRun(run, rows){
  const used = new Set();
  const order = [];
  for(const item of run){
    let best = null, bestScore = -1, second = -1;
    for(const row of rows){
      const s = itemRowScore(item.text, row);
      if(s > bestScore){ second = bestScore; bestScore = s; best = row; }
      else if(s > second){ second = s; }
    }
    if(!best || bestScore < 2 || bestScore - second < 2) return null;
    const id = validateTicketId(best.id);
    if(used.has(id)) return null;
    used.add(id);
    order.push(id);
  }
  return order;
}

/* Rows re-ordered to the visible numbered list. Rows the list does not
   mention keep their original relative order after the listed ones. Returns
   the input (same array) when nothing can be aligned safely. */
export function alignRowsToAnswer(answer, rows){
  const list = uniqueRows(rows);
  if(list.length < 2) return Array.isArray(rows) ? rows : [];
  const runs = numberedRuns(answer).filter(function(run){ return run.length >= 2 && run.length <= list.length; });
  for(const run of runs){
    const order = resolveRun(run, list);
    if(!order) continue;
    const byId = new Map(list.map(function(row){ return [validateTicketId(row.id), row]; }));
    const listed = order.map(function(id){ return byId.get(id); });
    const rest = list.filter(function(row){ return order.indexOf(validateTicketId(row.id)) === -1; });
    return listed.concat(rest);
  }
  return list;
}
