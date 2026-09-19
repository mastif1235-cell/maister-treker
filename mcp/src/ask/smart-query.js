/* Deterministic smart-search engine behind the `query_tickets` /
   `list_catalog` READ tools.

   Architectural rule: CODE SEARCHES AND CALCULATES — the model only formats.
   Everything here is a pure function of the redacted projection
   ({tickets, shifts, searchIndex}); there is no clock, no I/O, no guessing.

   Guarantees implemented here:
   - structured item conditions bind attributes (price/qty/total) to the SAME
     item («router at 1500» is never satisfied by another work priced 1500);
   - all aggregates (count/group/stats/unique/totals) run over the FULL
     filtered set; pagination is applied strictly afterwards;
   - signal comparisons keep the strict v91.43 semantics
     (worse_than=-25 excludes -25; worse_or_equal=-25 includes it);
   - legacy/text evidence is reported as 'legacy_text', structured as
     'structured'; derived equipment qty (saved rows carry no native qty) is
     reported as derived, never as an original database quantity;
   - nothing here ever returns raw private notes, phones or coordinates to
     the caller: rows are compact projections only. */

import {cleanStr, normalizeStem, matchScore, normalizeHouse, effectiveAddressParts, canonicalCityKey, placeTokens} from './address.js';
import {buildCanonicalCatalog, resolveCanonicalAddress, cityFilterAccepts, cityStemAccepts, streetFilterAccepts} from './canonical.js';
import {parseDateKey, DATE_RE} from '../gas/mappers.js';

/* ---------- normalization ---------- */

/* Item/label normalization: case-insensitive, UA/RU letter bridges,
   punctuation collapsed to spaces (so «патч-корд» == «патч корд»). */
export function normItem(value){
  return String(value == null ? '' : value).toLowerCase()
    .replace(/ё/g, 'е').replace(/ґ/g, 'г')
    .replace(/[іїйы]/g, 'и').replace(/[эє]/g, 'е')
    .replace(/ь/g, '')
    .replace(/['’`ʼ]/g, '')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Short stems (<= 3 chars, e.g. 'ону', 'фоб', 'утп', 'вуз') match only as
   whole tokens — substring matching of 2-3 letter fragments would produce
   false positives inside unrelated words. Longer stems match as substrings,
   and a normalized label of >= 4 chars may also be contained in the query. */
function stemMatches(hay, stem){
  if(!hay || !stem) return false;
  if(stem.length <= 3){
    if(hay === stem) return true;
    return hay.split(' ').some(function(token){ return token === stem; });
  }
  if(hay.includes(stem)) return true;
  return hay.length >= 4 && stem.includes(hay);
}

/* ---------- item concept synonyms ----------
   User-facing names are free text; concepts map natural language to REAL
   catalog labels. A concept never invents a position: resolution only
   returns labels that actually exist in the data. */
export const ITEM_CONCEPTS = [
  {concept:'router', stems:['роутер', 'маршрутиз', 'роутэр', 'router', 'wifi']},
  {concept:'onu', stems:['ону', 'онушк', 'ону', 'onu', 'ont', 'терминал']},
  {concept:'connector', stems:['конектор', 'коннектор', 'коннект', 'конект', 'connector', 'sc', 'apc']},
  {concept:'fob', stems:['фоб', 'фобу', 'фоба', 'fob', 'коробк', 'бокс']},
  {concept:'splice', stems:['муфт']},
  {concept:'node', stems:['вузол', 'узел', 'вузла']},
  {concept:'splitter', stems:['сплиттер', 'сплтер', 'сплитер', 'сплит']},
  {concept:'patchcord', stems:['патчкорд', 'патч корд', 'патч']},
  {concept:'utp', stems:['утп', 'utp', 'вита пара', 'витая пара', 'вилок', 'кабель вито']},
  {concept:'fiber', stems:['оптик', 'оптика', 'волс', 'дроп', 'дропа', 'кабель оптическ', 'кабель оптичн']}
];

export function conceptForText(text){
  const n = normItem(text);
  if(!n) return null;
  for(const c of ITEM_CONCEPTS){
    if(c.stems.some(function(stem){ return stemMatches(n, stem); })) return c.concept;
  }
  return null;
}

function conceptDef(concept){
  return ITEM_CONCEPTS.find(function(c){ return c.concept === concept; }) || null;
}

/* Does a real data label satisfy the condition text (via concept or direct
   normalized containment)? */
export function labelMatchesCondition(label, condition, resolution){
  const n = normItem(label);
  if(!n) return false;
  if(resolution && resolution.concept){
    const def = conceptDef(resolution.concept);
    if(def && def.stems.some(function(stem){ return stemMatches(n, stem); })) return true;
  }
  const t = normItem(condition && condition.text);
  if(t.length >= 3 && n.includes(t)) return true;
  if(t.length >= 4 && n.length >= 4 && t.includes(n)) return true;
  return false;
}

/* Resolve a user phrase against the REAL catalog labels of one pool.
   Returns {concept, labels, matchedInCatalog}. Labels are copied verbatim
   from the data — nothing is invented. */
export function resolveItemText(text, catalogLabels){
  const concept = conceptForText(text);
  const labels = [];
  for(const label of catalogLabels || []){
    if(labelMatchesCondition(label, {text}, {concept})){
      if(labels.indexOf(label) === -1) labels.push(label);
    }
  }
  return {concept, labels, matchedInCatalog: labels.length > 0};
}

/* ---------- catalog ---------- */

const CATALOG_CAP = 40;

function poolCount(list, labelOf){
  const map = new Map();
  for(const item of list || []){
    const label = String(labelOf(item) == null ? '' : labelOf(item)).trim();
    if(!label) continue;
    map.set(label, (map.get(label) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(function(e){ return {label:e[0], count:e[1]}; })
    .sort(function(a, b){ return b.count - a.count || a.label.localeCompare(b.label, 'uk'); })
    .slice(0, CATALOG_CAP);
}

/* Deterministic catalog derived from ACTUAL ticket data (what was really
   used/installed), never from the user-editable settings catalog. */
export function buildCatalogData(tickets, shifts){
  const equipment = [], cables = [], preset = [], additional = [];
  const tagMap = new Map(), cityMap = new Map();
  for(const t of tickets || []){
    equipment.push.apply(equipment, (t && t.equipment) || []);
    cables.push.apply(cables, (t && t.cables) || []);
    preset.push.apply(preset, (t && t.presetWorks) || []);
    additional.push.apply(additional, (t && t.additionalWork) || []);
    for(const tag of (t && t.tags) || []) tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
    const city = String((t && t.city) || '').trim();
    if(city) cityMap.set(city, (cityMap.get(city) || 0) + 1);
  }
  const fromMap = function(map, cap){
    return Array.from(map.entries())
      .map(function(e){ return {name:e[0], count:e[1]}; })
      .sort(function(a, b){ return b.count - a.count || a.name.localeCompare(b.name, 'uk'); })
      .slice(0, cap);
  };
  const coworkerMap = new Map();
  for(const s of shifts || []){
    const name = String((s && s.coworker) || '').trim();
    if(!name) continue;
    for(const part of name.split(',').map(function(p){ return p.trim(); }).filter(Boolean)){
      coworkerMap.set(part, (coworkerMap.get(part) || 0) + 1);
    }
  }
  return {
    total_tickets: (tickets || []).length,
    equipment: poolCount(equipment, function(e){ return e && e.label; }),
    cables: poolCount(cables, function(c){ return c && c.label; }),
    preset_works: poolCount(preset, function(w){ return w && w.label; }),
    additional_works: poolCount(additional, function(w){ return w && w.desc; }),
    tags: fromMap(tagMap, CATALOG_CAP),
    cities: fromMap(cityMap, CATALOG_CAP),
    coworkers: fromMap(coworkerMap, CATALOG_CAP)
  };
}

/* ---------- dates ---------- */

/* parseDateKey accepts day<=31 for any month; the query engine additionally
   requires a REAL calendar date (31.02.2026 must be rejected, not searched). */
export function parseDateKeyStrict(value){
  if(typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const key = parseDateKey(value);
  if(!key) return null;
  const parts = key.split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  if(d.getFullYear() !== parts[0] || d.getMonth() !== parts[1] - 1 || d.getDate() !== parts[2]) return null;
  return key;
}

/* v91.48: ticket-side (not user-input) date key. Historical rows may carry
   «5.7.2026» (single-digit day/month) or stray spaces; the strict parser
   rejects those, which used to remove the ticket from EVERY query — even a
   pure city count. Zero-padding recovers the real calendar date; anything
   that still does not parse stays without a key (and is only excluded when
   the user actually asked for a date range). User-supplied filter values go
   through parseDateKeyStrict as before. */
export function ticketDateKey(value){
  const strict = parseDateKeyStrict(value);
  if(strict) return strict;
  const m = /^\s*(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{4})\s*$/.exec(String(value == null ? '' : value));
  if(!m) return null;
  const padded = m[1].padStart(2, '0') + '.' + m[2].padStart(2, '0') + '.' + m[3];
  return parseDateKeyStrict(padded);
}

/* ---------- signals ---------- */

export function ticketSignalNumber(t){
  const text = String((t && t.signal) == null ? '' : t.signal).trim();
  if(!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/* ---------- addresses ---------- */

/* «Миколаївка 1» and «Миколаївка 2» differ only by a trailing digit; fuzzy
   stem scoring would merge them, so explicit digit guards are applied. */
function trailingDigitToken(value){
  const m = /(?:^|\s)(\d+)\s*$/.exec(String(value || '').trim());
  return m ? m[1] : null;
}

export function cityDigitsConflict(a, b){
  const da = trailingDigitToken(a), db = trailingDigitToken(b);
  return da != null && db != null && da !== db;
}

/* City match = structured field authoritative, token/stem legacy fallback
   when structured city is absent (same semantics as list_tickets, plus the
   trailing-digit guard above). */
export function cityMatches(ticket, wantedCity, legacyText){
  if(!wantedCity) return {ok:true, via:null};
  if(ticket.city){
    if(cityDigitsConflict(ticket.city, wantedCity)) return {ok:false, via:null};
    return matchScore(ticket.city, wantedCity) >= 0.72 ? {ok:true, via:'structured'} : {ok:false, via:null};
  }
  const rawTokens = cleanStr(legacyText).replace(/ё/g, 'е').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const textStems = rawTokens.map(normalizeStem);
  const cityTokens = wantedCity.split(/\s+/).filter(Boolean).map(normalizeStem);
  if(!cityTokens.length) return {ok:false, via:null};
  const ok = cityTokens.every(function(stem){ return stem && textStems.includes(stem); });
  return {ok, via: ok ? 'legacy' : null};
}

export function streetMatches(ticket, wantedStreet){
  if(!wantedStreet) return {ok:true, via:null};
  const tStreet = String(ticket.street || '').trim();
  if(!tStreet) return {ok:false, via:null};
  if(normalizeStem(tStreet) === normalizeStem(wantedStreet)) return {ok:true, via:'structured'};
  return matchScore(tStreet, wantedStreet) >= 0.75 ? {ok:true, via:'structured'} : {ok:false, via:null};
}

/* v91.45: one real city may appear under several historical spellings
   (Таромське / Таромское). Identity = canonicalCityKey; the DISPLAYED name
   stays a real human variant from the data — the most frequent one, with a
   deterministic localeCompare tie-break. */
function topCityVariant(variants){
  let best = null;
  for(const entry of variants){
    const name = entry[0], count = entry[1];
    if(!best || count > best.count || (count === best.count && name.localeCompare(best.name, 'uk') < 0)) best = {name: name, count: count};
  }
  return best ? best.name : '';
}

/* ---------- item conditions ---------- */

export const ITEM_KINDS = ['equipment', 'cable', 'preset_work', 'additional_work'];

const ITEM_POOLS = [
  {kind:'equipment', pick:function(t){ return t.equipment; }, label:function(e){ return e && e.label; }},
  {kind:'cable', pick:function(t){ return t.cables; }, label:function(c){ return c && c.label; }},
  {kind:'preset_work', pick:function(t){ return t.presetWorks; }, label:function(w){ return w && w.label; }},
  {kind:'additional_work', pick:function(t){ return t.additionalWork; }, label:function(w){ return w && w.desc; }}
];

function conditionHasAttributes(condition){
  return condition.unit_price != null || condition.quantity != null || condition.total != null;
}

/* Attribute binding happens on ONE item: unit_price compares the item's own
   price (or pricePerMeter/sum), quantity the item's own qty/meters, total
   the item's own total. Numeric equality mirrors the app's exact pricing. */
export function itemAttributesMatch(item, condition){
  if(condition.unit_price != null && Number(item.price || item.pricePerMeter || item.sum) !== Number(condition.unit_price)) return false;
  if(condition.quantity != null && Number(item.qty || item.meters || 0) !== Number(condition.quantity)) return false;
  if(condition.total != null && Number(item.total || item.sum || (Number(item.price || 0) * Number(item.qty || 1))) !== Number(condition.total)) return false;
  return true;
}

/* Match one condition against one ticket. Returns {ok, evidence, pool,
   label, qty_derived} — evidence is 'structured' when a structured pool item
   carries the fact, 'legacy_text' when only legacy searchable text proves a
   TEXT-ONLY condition (attribute conditions can never be legacy). */
export function ticketItemEvidence(ticket, condition, catalogLabels, legacyText){
  const resolution = resolveItemText(condition.text, catalogLabels);
  const wantedPool = condition.kind || null;
  for(const pool of ITEM_POOLS){
    if(wantedPool && wantedPool !== pool.kind) continue;
    for(const item of pool.pick(ticket) || []){
      if(!labelMatchesCondition(pool.label(item), condition, resolution)) continue;
      if(!itemAttributesMatch(item, condition)) continue;
      const qtyDerived = pool.kind === 'equipment' && item && item.qty_derived === true;
      return {ok:true, evidence:'structured', pool:pool.kind, label:pool.label(item), qty_derived:qtyDerived};
    }
  }
  /* Legacy fallback: text-only conditions may be proven by legacy searchable
     text (old tickets without structured items). */
  if(!conditionHasAttributes(condition)){
    const needle = normItem(condition.text);
    const hay = normItem(legacyText);
    if(needle && needle.length >= 3 && hay.includes(needle)){
      return {ok:true, evidence:'legacy_text', pool:null, label:String(condition.text), qty_derived:false};
    }
  }
  return {ok:false, evidence:null, pool:null, label:null, matchedInCatalog:resolution.matchedInCatalog};
}

/* ---------- coworker matching ---------- */

/* Common UA/RU name forms of the SAME person (deterministic alias table —
   no fuzzy guessing beyond it). */
const NAME_ALIASES = [
  ['женя', 'жека', 'евген', 'евгени'],
  ['саша', 'саня', 'александр', 'олександр'],
  ['дима', 'димон', 'дмитро', 'дмитрии'],
  ['ваня', 'иван'],
  ['коля', 'микола', 'николаи'],
  ['серега', 'серги', 'сергеи', 'серыи'],
  ['андрюха', 'андрии', 'андреи'],
  ['влад', 'владик', 'владислав'],
  ['миша', 'михаило', 'михаил'],
  ['макс', 'максим'],
  ['юра', 'юрии'],
  ['петя', 'петро', 'петр'],
  ['виталя', 'витали', 'виталии'],
  ['леха', 'олеки', 'алексеи']
];

function aliasOf(token){
  for(const group of NAME_ALIASES){
    if(group.indexOf(token) !== -1) return group[0];
  }
  return null;
}

function nameTokens(name){
  return normItem(name).split(' ').filter(function(t){ return t.length >= 3; });
}

export function coworkerNameMatches(storedName, query){
  const q = cleanStr(query);
  if(!q) return false;
  const s = cleanStr(storedName);
  if(s.includes(q) || q.includes(s)) return true;
  const qt = nameTokens(query), st = nameTokens(storedName);
  if(!qt.length || !st.length) return false;
  return qt.some(function(qTok){
    const qAlias = aliasOf(qTok);
    return st.some(function(sTok){
      if(qTok === sTok) return true;
      if(qTok.length >= 5 && sTok.length >= 5 && (qTok.startsWith(sTok) || sTok.startsWith(qTok))) return true;
      const sAlias = aliasOf(sTok);
      return qAlias != null && qAlias === sAlias;
    });
  });
}

/* ---------- the query runner ---------- */

const GROUP_KEYS = ['city', 'street', 'house', 'date', 'month', 'type', 'payment', 'item', 'coworker'];
const MODES = ['exists', 'count', 'list', 'group', 'stats'];

function fmtKeyToDate(key){
  if(!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return key.split('-').reverse().join('.');
}

function round1(value){ return Math.round(value * 10) / 10; }

function compactAddress(t){
  const parts = [];
  const push = function(v){ const s = String(v == null ? '' : v).trim(); if(s && parts.indexOf(s) === -1) parts.push(s); };
  push(t.city);
  const street = [String(t.street || '').trim(), String(t.house || '').trim()].filter(Boolean).join(' ');
  push(street);
  if(t.apartment) push('кв. ' + String(t.apartment).trim());
  if(!parts.length) push(t.address);
  return parts.join(', ').slice(0, 200);
}

function sortNewestFirst(list){
  return list.slice().sort(function(a, b){
    const ka = parseDateKey(a.date) || '';
    const kb = parseDateKey(b.date) || '';
    if(ka !== kb) return ka < kb ? 1 : -1;
    return String(b.time || '').localeCompare(String(a.time || ''));
  });
}

/* ctx: {tickets, shifts, searchIndex, data_as_of}. Returns
   {ok:false, code, message} or {ok:true, data:{...envelope}}. */
export function runSmartQuery(ctx, params){
  params = params || {};
  const tickets = Array.isArray(ctx.tickets) ? ctx.tickets : [];
  const shifts = Array.isArray(ctx.shifts) ? ctx.shifts : [];
  const searchIndex = Array.isArray(ctx.searchIndex) ? ctx.searchIndex : [];
  const legacyTextById = new Map(searchIndex.map(function(item){ return [String(item.id), String(item.text || '')]; }));
  /* v91.48: canonical catalog built from the user's OWN structured values,
     so legacy/incomplete rows resolve exactly like the app's address
     navigator groups them. Built once per query — deterministic. */
  const catalog = buildCanonicalCatalog(tickets);

  const mode = params.mode || 'list';
  if(MODES.indexOf(mode) === -1) return {ok:false, code:'INVALID_INPUT', message:'Некоректний mode (доступні: exists, count, list, group, stats)'};
  const groupBy = params.group_by || null;
  if(mode === 'group' && GROUP_KEYS.indexOf(groupBy) === -1){
    return {ok:false, code:'INVALID_INPUT', message:'group_by обовʼязковий для mode=group (city, street, house, date, month, type, payment, item, coworker)'};
  }

  const from = params.date_from != null ? parseDateKeyStrict(params.date_from) : null;
  const to = params.date_to != null ? parseDateKeyStrict(params.date_to) : null;
  if((params.date_from != null && !from) || (params.date_to != null && !to)){
    return {ok:false, code:'INVALID_INPUT', message:'Некоректна дата (потрібен формат ДД.ММ.РРРР, реальна календарна дата)'};
  }

  const wantedCity = params.city ? cleanStr(params.city).replace(/^(?:в|у|во)\s+/, '') : null;
  const wantedStreet = params.street ? cleanStr(params.street).replace(/^(?:вул|ул|улица|вулиця)\.?\s*/i, '') : null;
  const wantedHouse = params.house != null ? normalizeHouse(params.house) : null;
  const wantedType = params.type ? cleanStr(params.type) : null;
  const wantedPayment = params.payment ? cleanStr(params.payment) : null;
  const wantedTags = Array.isArray(params.tags) ? params.tags.slice() : null;
  const conditions = Array.isArray(params.items) ? params.items : [];
  const notes = [];

  /* payment aliases (deterministic, both languages) */
  let paymentTarget = wantedPayment;
  if(paymentTarget){
    if(/готівк|готивк|наличн|кеш|кэш|готивк/.test(paymentTarget)) paymentTarget = 'готівка';
    else if(/безготівк|безнал|карт|перевод|переказ|термінал|терминал/.test(paymentTarget)) paymentTarget = 'безготівка';
    else if(/зм[іе]шан/.test(paymentTarget)) paymentTarget = 'змішана';
    else if(/безкоштовн|безплатн|бесплатн|0 грн/.test(paymentTarget)) paymentTarget = 'безкоштовно';
  }

  /* resolve item condition labels against the real catalog up front */
  const allItemLabels = tickets.flatMap(function(t){
    return [].concat(
      (t.equipment || []).map(function(e){ return e && e.label; }),
      (t.cables || []).map(function(c){ return c && c.label; }),
      (t.presetWorks || []).map(function(w){ return w && w.label; }),
      (t.additionalWork || []).map(function(w){ return w && w.desc; })
    );
  }).filter(Boolean);
  const resolvedItems = conditions.map(function(condition){
    const resolution = resolveItemText(condition.text, allItemLabels);
    if(!resolution.matchedInCatalog) notes.push('Позиція «' + String(condition.text).slice(0, 60) + '» не знайдена серед структурованих матеріалів/робіт у базі — можливе обмеження текстовим пошуком по старих заявках.');
    return {condition, resolution};
  });

  const coworkerQuery = params.coworker ? String(params.coworker).trim() : null;
  const coworkerShiftDates = new Map(); /* date -> hours with that coworker */
  if(coworkerQuery){
    for(const s of shifts){
      if(coworkerNameMatches(s.coworker, coworkerQuery)){
        coworkerShiftDates.set(String(s.date), (coworkerShiftDates.get(String(s.date)) || 0) + (Number(s.hours) || 0));
      }
    }
  }

  const phoneDigits = params.phone_digits ? String(params.phone_digits).replace(/\D/g, '') : '';
  if(params.phone_digits && phoneDigits.length < 3){
    return {ok:false, code:'INVALID_INPUT', message:'Для пошуку за телефоном потрібно щонайменше 3 цифри.'};
  }
  const contractQuery = params.contract ? cleanStr(params.contract) : null;
  const macQuery = params.mac ? String(params.mac).toLowerCase().replace(/[^0-9a-f]/g, '') : null;
  if(params.mac && macQuery.length < 4){
    return {ok:false, code:'INVALID_INPUT', message:'Для пошуку за MAC потрібно щонайменше 4 символи.'};
  }

  const signalParsedCount = {parsed:0, missing:0};
  const geoWithCount = {with_geo:0};
  const rangeCount = {total:0};
  const matched = [];
  const reasonsFor = new Map();

  for(const t of tickets){
    /* v91.48: a legacy date format («5.7.2026») must not silently exclude a
       ticket from a query that carries NO date filter at all; when a filter
       is present the tolerant key is still compared, so such rows are no
       longer invisible to date questions either. */
    const key = ticketDateKey(t.date);
    if(from || to){
      if(!key) continue;
      if(from && key < from) continue;
      if(to && key > to) continue;
    }
    rangeCount.total++;

    const reasons = [];
    const legacyText = legacyTextById.get(String(t.id)) || '';
    /* v91.45 legacy/restored addresses: structured fields stay authoritative;
       a deterministic parse of the ticket's own address (or the legacy
       «Місто/Адреса» lines) fills ONLY the missing parts — the same semantics
       the app's ordinary text search relies on. One parsed view is used by
       every filter, group and aggregate below, so count/list never diverge. */
    const addr = resolveCanonicalAddress(t, legacyText, catalog);
    const tAddr = {city: addr.city, street: addr.street, house: addr.house};

    const cityOk = cityFilterAccepts(addr.city, wantedCity, legacyText) || cityStemAccepts(addr.city, wantedCity);
    if(!cityOk) continue;
    if(wantedCity){
      const via = addr.via.city === 'legacy' ? 'legacy адреса'
        : addr.via.city === 'canonical-legacy' ? 'legacy текст (канонічне місто)'
        : addr.via.city === 'canonical-completed' ? 'структурне (доповнено до канонічного)'
        : 'структурне';
      reasons.push('місто:' + via);
    }

    if(wantedStreet){
      if(!streetFilterAccepts(addr.street, wantedStreet)) continue;
      reasons.push('вулиця:' + (addr.via.street === 'legacy' ? 'legacy адреса' : 'структурна'));
    }
    if(wantedHouse && normalizeHouse(addr.house) !== wantedHouse) continue;
    if(params.apartment != null && cleanStr(t.apartment) !== cleanStr(params.apartment)) continue;
    if(wantedType && cleanStr(t.type) !== wantedType) continue;
    if(paymentTarget && cleanStr(t.payment) !== paymentTarget) continue;
    if(wantedTags && !wantedTags.some(function(tag){ return (t.tags || []).includes(tag); })) continue;
    if(params.sum_min != null && Number(t.sum) < Number(params.sum_min)) continue;
    if(params.sum_max != null && Number(t.sum) > Number(params.sum_max)) continue;

    const sigNum = ticketSignalNumber(t);
    if(params.has_signal === true && sigNum == null) continue;
    if(params.has_signal === false && sigNum != null) continue;
    if(params.signal_worse_than != null){
      if(sigNum == null || sigNum >= params.signal_worse_than) continue;
      reasons.push('сигнал:' + sigNum + ' < ' + params.signal_worse_than);
    }
    if(params.signal_worse_or_equal != null){
      if(sigNum == null || sigNum > params.signal_worse_or_equal) continue;
      reasons.push('сигнал:' + sigNum + ' ≤ ' + params.signal_worse_or_equal);
    }
    if(params.signal_better_than != null){
      if(sigNum == null || sigNum < params.signal_better_than) continue;
      reasons.push('сигнал:' + sigNum + ' ≥ ' + params.signal_better_than);
    }

    if(phoneDigits){
      const candidates = [t.phone].concat(t.extraPhones || []);
      const hit = candidates.some(function(p){ return String(p || '').replace(/\D/g, '').includes(phoneDigits); });
      if(!hit) continue;
      reasons.push('ідентифікатор:телефон (збіг цифр)');
    }
    if(contractQuery){
      if(!cleanStr(t.contractNumber).includes(contractQuery)) continue;
      reasons.push('ідентифікатор:договір');
    }
    if(macQuery){
      const tMac = String(t.macAddress || '').toLowerCase().replace(/[^0-9a-f]/g, '');
      if(!tMac.includes(macQuery)) continue;
      reasons.push('ідентифікатор:MAC');
    }

    let coworkerEvidence = null;
    if(coworkerQuery){
      const direct = (t.connectMasters || []).some(function(name){ return coworkerNameMatches(name, coworkerQuery); });
      if(direct) coworkerEvidence = 'direct';
      else if(coworkerShiftDates.has(String(t.date))) coworkerEvidence = 'same_day_shift';
      if(!coworkerEvidence) continue;
      reasons.push('напарник:' + (coworkerEvidence === 'direct' ? 'заявка (структурно)' : 'збіг за зміною того ж дня'));
    }

    const itemReasons = [];
    let itemsOk = true;
    const matchedItemLabels = [];
    for(const entry of resolvedItems){
      const result = ticketItemEvidence(t, entry.condition, entry.resolution.labels, legacyText);
      if(!result.ok){ itemsOk = false; break; }
      matchedItemLabels.push(result.label);
      itemReasons.push(String(entry.condition.text).slice(0, 40) + ':' + (result.evidence === 'legacy_text' ? 'legacy текст' : result.pool) + (result.qty_derived ? ' (кількість похідна)' : ''));
    }
    if(!itemsOk) continue;
    reasons.push.apply(reasons, itemReasons);

    /* full-set coverage counters (computed for every row passing the range) */
    if(sigNum != null) signalParsedCount.parsed++; else signalParsedCount.missing++;
    if(t.has_geo) geoWithCount.with_geo++;

    matched.push(t);
    reasonsFor.set(t.id, {reasons, coworkerEvidence, matchedItemLabels, addr});
  }

  const sorted = sortNewestFirst(matched);

  /* Ambiguity: same street name in multiple cities without a city filter is
     reported, never guessed. */
  if(wantedStreet && !wantedCity){
    /* v91.45: ambiguity must see the SAME effective address the ticket passed
       the street filter with — raw t.city is empty on legacy rows, so the
       effective city is read from the addr view already stored in
       reasonsFor (no second parse). Spellings of one real city are collapsed
       by canonicalCityKey, so Таромське/Таромское never produce a false
       ambiguity, while Миколаївка 1/Миколаївка 2 always remain two cities. */
    const citiesByCanonical = new Map();
    for(const t of sorted){
      const info = reasonsFor.get(t.id);
      const c = String((info && info.addr && info.addr.city) || '').trim();
      if(!c) continue;
      const key = canonicalCityKey(c) || c;
      if(!citiesByCanonical.has(key)) citiesByCanonical.set(key, new Map());
      const variants = citiesByCanonical.get(key);
      variants.set(c, (variants.get(c) || 0) + 1);
    }
    if(citiesByCanonical.size > 1){
      const list = Array.from(citiesByCanonical.values()).map(topCityVariant)
        .sort(function(a, b){ return a.localeCompare(b, 'uk'); });
      return {ok:true, data:envelope({
        mode, ambiguous:true,
        candidates:list.map(function(c){ return {city:c}; }),
        notes:notes.concat(['Вулиця «' + wantedStreet + '» є у кількох містах: ' + list.join(', ') + '. Уточніть місто.']),
        matched:0, sorted:[], reasonsFor, signalParsedCount, geoWithCount, rangeCount,
        resolvedFilters:buildResolvedFilters(), from, to, params, tickets
      })};
    }
  }

  /* v91.48: a city asked WITHOUT its part number may legitimately span
     several numbered parts; the answer stays complete but is flagged so the
     model asks the user to pick one instead of pretending it is one place. */
  let cityStemAmbiguous = false;
  if(wantedCity && !placeTokens(wantedCity).digits.length){
    const parts = new Set();
    for(const t of sorted){
      const info = reasonsFor.get(t.id);
      const c = String((info && info.addr && info.addr.city) || '').trim();
      if(c) parts.add(canonicalCityKey(c) || c);
    }
    if(parts.size > 1){
      cityStemAmbiguous = true;
      const list = [...parts].map(function(k){
        for(const t of sorted){
          const info = reasonsFor.get(t.id);
          const c = String((info && info.addr && info.addr.city) || '').trim();
          if(c && (canonicalCityKey(c) || c) === k) return c;
        }
        return k;
      }).sort(function(a, b){ return a.localeCompare(b, 'uk'); });
      notes.push('Запит без номера частини охоплює кілька населених пунктів: ' + list.join(', ') + '. Уточніть, який саме потрібен.');
    }
  }

  return {ok:true, data:envelope({
    mode, groupBy, ambiguous:cityStemAmbiguous, notes, matched:sorted.length, sorted, reasonsFor,
    signalParsedCount, geoWithCount, resolvedFilters:buildResolvedFilters(), from, to, params, tickets,
    coworkerQuery, coworkerShiftDates, conditions:resolvedItems
  })};

  function buildResolvedFilters(){
    const rf = {};
    if(from) rf.date_from = params.date_from;
    if(to) rf.date_to = params.date_to;
    if(wantedCity) rf.city = params.city;
    if(wantedStreet) rf.street = params.street;
    if(wantedHouse) rf.house = String(params.house);
    if(params.apartment != null) rf.apartment = String(params.apartment);
    if(wantedTags && wantedTags.length) rf.tags = wantedTags.slice(0, 20).map(function(tag){ return String(tag).slice(0, 60); });
    if(wantedType) rf.type = params.type;
    if(paymentTarget) rf.payment = params.payment;
    if(params.sum_min != null) rf.sum_min = params.sum_min;
    if(params.sum_max != null) rf.sum_max = params.sum_max;
    if(params.signal_worse_than != null) rf.signal_worse_than = params.signal_worse_than;
    if(params.signal_worse_or_equal != null) rf.signal_worse_or_equal = params.signal_worse_or_equal;
    if(params.signal_better_than != null) rf.signal_better_than = params.signal_better_than;
    if(params.has_signal != null) rf.has_signal = params.has_signal;
    if(phoneDigits) rf.phone_digits = {provided:true, length:phoneDigits.length};
    if(contractQuery) rf.contract = true;
    if(macQuery) rf.mac = true;
    if(coworkerQuery) rf.coworker = coworkerQuery;
    if(resolvedItems.length){
      rf.items = resolvedItems.map(function(entry){
        const out = {text:String(entry.condition.text).slice(0, 80)};
        /* v91.46: keep the ORIGINAL condition (what the engine re-runs).
           kind is the pool constraint — losing it would silently widen a
           follow-up search to other item pools. */
        if(ITEM_KINDS.indexOf(entry.condition.kind) !== -1) out.kind = entry.condition.kind;
        if(entry.condition.unit_price != null) out.unit_price = entry.condition.unit_price;
        if(entry.condition.quantity != null) out.quantity = entry.condition.quantity;
        if(entry.condition.total != null) out.total = entry.condition.total;
        return out;
      });
    }
    return rf;
  }

  function envelope(args){
    const base = {
      tool:'query_tickets',
      mode:args.mode,
      matched:args.matched,
      scanned_total:tickets.length,
      total_matched:args.matched,
      ambiguous:args.ambiguous,
      resolved_filters:args.resolvedFilters,
      coverage:{
        tickets_in_range:rangeCount.total,
        matched:args.matched,
        signals_parsed:args.signalParsedCount.parsed,
        signals_missing:args.signalParsedCount.missing,
        tickets_with_geo:args.geoWithCount.with_geo
      },
      notes:args.notes.slice(0, 8)
    };
    if(ctx.data_as_of) base.data_as_of = ctx.data_as_of;
    if(ctx.snapshot_cache) base.snapshot_cache = ctx.snapshot_cache;
    if(args.candidates) base.candidates = args.candidates;
    return fillByMode(base, args);
  }

  function itemTotals(list, modeArgs){
    /* Deterministic item aggregate over the FULL matched set: quantity and
       sum of the matched items themselves (router count question). */
    let quantity = 0, sum = 0, derivedQty = 0, ticketCount = 0;
    for(const t of list){
      const info = modeArgs.reasonsFor.get(t.id);
      if(!info || !info.matchedItemLabels.length) continue;
      ticketCount++;
      for(const entry of resolvedItems){
        for(const pool of ITEM_POOLS){
          for(const item of pool.pick(t) || []){
            if(info.matchedItemLabels.indexOf(pool.label(item)) === -1) continue;
            if(!labelMatchesCondition(pool.label(item), entry.condition, entry.resolution)) continue;
            if(!itemAttributesMatch(item, entry.condition)) continue;
            const q = pool.kind === 'cable' ? (Number(item.meters) || 0) : (pool.kind === 'additional_work' ? 0 : (Number(item.qty) || 1));
            quantity += q;
            const itemSum = pool.kind === 'cable'
              ? (Number(item.meters) || 0) * (Number(item.pricePerMeter) || 0)
              : (pool.kind === 'additional_work' ? (Number(item.sum) || 0) : (Number(item.total) || (Number(item.price) || 0) * (Number(item.qty) || 1)));
            sum += itemSum;
            if(pool.kind === 'equipment' && item.qty_derived) derivedQty += q;
          }
        }
      }
    }
    return {tickets_with_item:ticketCount, quantity:round1(quantity), sum:round1(sum), derived_quantity:derivedQty};
  }

  function fillByMode(base, args){
    const list = args.sorted;
    const limit = args.params.limit == null ? 50 : args.params.limit;
    const offset = args.params.offset || 0;

    if(args.mode === 'exists'){
      base.exists = args.matched > 0;
      if(list.length){
        base.first_date = list[list.length - 1].date;
        base.last_date = list[0].date;
      }
      return base;
    }
    if(args.mode === 'count'){
      if(resolvedItems.length) base.item_totals = itemTotals(list, args);
      return base;
    }
    if(args.mode === 'group'){
      base.group_by = args.groupBy;
      base.groups = buildGroups(list, args);
      return base;
    }
    if(args.mode === 'stats'){
      base.stats = buildStats(list, args);
      return base;
    }
    /* list mode */
    base.returned = Math.max(0, Math.min(limit, list.length - offset));
    base.offset = offset;
    base.limit = limit;
    base.tickets = list.slice(offset, offset + limit).map(function(t, idx){
      const info = args.reasonsFor.get(t.id) || {reasons:[]};
      const sigNum = ticketSignalNumber(t);
      return {
        ord:offset + idx + 1,
        id:String(t.id).slice(0, 64),
        date:t.date, time:t.time,
        city:String(info.addr ? info.addr.city : (t.city || '')).slice(0, 80),
        street:String(info.addr ? info.addr.street : (t.street || '')).slice(0, 100),
        house:String(info.addr ? info.addr.house : (t.house || '')).slice(0, 16),
        address:compactAddress(t),
        type:String(t.type || '').slice(0, 80),
        sum:Number(t.sum) || 0,
        payment:String(t.payment || '').slice(0, 40),
        signal:sigNum != null ? String(sigNum) : '',
        has_geo:!!t.has_geo,
        match_reasons:info.reasons.slice(0, 6)
      };
    });
    /* full-set analytics (independent of the page above); city spellings are
       collapsed by canonicalCityKey so one real city never doubles up. */
    const cities = Object.create(null), streets = Object.create(null);
    const cityAnalyticsVariants = new Map();
    for(const t of list){
      const a = (args.reasonsFor.get(t.id) || {}).addr || effectiveAddressParts(t, '');
      const street = a.street || '(без вулиці)';
      streets[street] = (streets[street] || 0) + 1;
      if(!a.city){ cities['(без міста)'] = (cities['(без міста)'] || 0) + 1; continue; }
      const key = canonicalCityKey(a.city) || a.city;
      cities[key] = (cities[key] || 0) + 1;
      if(!cityAnalyticsVariants.has(key)) cityAnalyticsVariants.set(key, new Map());
      const variants = cityAnalyticsVariants.get(key);
      variants.set(a.city, (variants.get(a.city) || 0) + 1);
    }
    for(const key of Object.keys(cities)){
      const variants = cityAnalyticsVariants.get(key);
      if(!variants) continue;
      const display = topCityVariant(variants);
      if(display === key) continue;
      cities[display] = cities[key];
      delete cities[key];
    }
    const groups = function(map, cap){
      return Object.keys(map).sort(function(a, b){ return map[b] - map[a] || a.localeCompare(b, 'uk'); })
        .slice(0, cap).map(function(name){ return {name, count:map[name]}; });
    };
    base.analytics = {unique_cities:groups(cities, 30), unique_streets:groups(streets, 60)};
    if(resolvedItems.length) base.item_totals = itemTotals(list, args);
    return base;
  }

  function buildGroups(list, args){
    const map = new Map();
    const cityVariantCounts = new Map(); /* canonical key -> Map(display -> count) */
    const add = function(keyLabel, t){
      if(!keyLabel) return;
      if(!map.has(keyLabel)) map.set(keyLabel, {key:keyLabel, count:0, sum:0, last_date:null});
      const entry = map.get(keyLabel);
      entry.count++;
      entry.sum = round1(entry.sum + (Number(t.sum) || 0));
      const key = parseDateKey(t.date) || '';
      const lastKey = entry.last_date ? (parseDateKey(entry.last_date) || '') : '';
      if(key >= lastKey) entry.last_date = t.date;
    };
    for(const t of list){
      const info = args.reasonsFor.get(t.id) || {};
      switch(args.groupBy){
        case 'city': {
          /* v91.45: city identity = canonicalCityKey — structured, legacy and
             differently-spelled variants of ONE real city form ONE group.
             The displayed group name stays a real human variant from the
             data (the most frequent spelling); the origin stays in
             match_reasons, never in the identity dimension. */
          const a = info.addr || effectiveAddressParts(t, legacyTextById.get(String(t.id)) || '');
          let display = a.city;
          if(!display && wantedCity && cityMatches(t, wantedCity, legacyTextById.get(String(t.id)) || '').via === 'legacy'){
            display = wantedCity;
          }
          if(!display){ add('(без міста)', t); break; }
          const key = canonicalCityKey(display) || display;
          if(!cityVariantCounts.has(key)) cityVariantCounts.set(key, new Map());
          const variants = cityVariantCounts.get(key);
          variants.set(display, (variants.get(display) || 0) + 1);
          add(key, t);
          break;
        }
        case 'street': {
          const a = info.addr || effectiveAddressParts(t, legacyTextById.get(String(t.id)) || '');
          add(a.street || '(без структурованої вулиці)', t);
          break;
        }
        case 'house': {
          const a = info.addr || effectiveAddressParts(t, legacyTextById.get(String(t.id)) || '');
          add(a.house || '(без номера)', t);
          break;
        }
        case 'date': add(String(t.date || ''), t); break;
        case 'month': {
          const key = parseDateKey(t.date);
          add(key ? key.slice(0, 7) : '(без дати)', t);
          break;
        }
        case 'type': add(String(t.type || '').trim() || '(без типу)', t); break;
        case 'payment': add(String(t.payment || '').trim() || '(без оплати)', t); break;
        case 'item': {
          const labels = info.matchedItemLabels || [];
          if(labels.length) labels.forEach(function(label){ add(label, t); });
          break;
        }
        case 'coworker': {
          const names = (t.connectMasters || []).map(function(n){ return String(n).trim(); }).filter(Boolean);
          if(names.length) names.forEach(function(n){ add(n, t); });
          else if(info.coworkerEvidence === 'same_day_shift') add('(спільна зміна, без прямої привʼязки)', t);
          break;
        }
      }
    }
    const rows = Array.from(map.values()).map(function(entry){
      /* Canonical keys are internal; restore a real human city name for
         display (most frequent spelling inside the group). */
      const variants = args.groupBy === 'city' ? cityVariantCounts.get(entry.key) : null;
      const displayKey = (variants && topCityVariant(variants)) || entry.key;
      return {key:displayKey, count:entry.count, sum:entry.sum, last_date:entry.last_date};
    }).sort(function(a, b){ return b.count - a.count || a.key.localeCompare(b.key, 'uk'); });
    return rows.slice(0, 100);
  }

  function buildStats(list, args){
    const total = list.reduce(function(s, t){ return s + (Number(t.sum) || 0); }, 0);
    let cash = 0, card = 0;
    const byPayment = new Map(), byType = new Map();
    let freeCount = 0;
    let best = {date:'', address:'', sum:0, type:''};
    for(const t of list){
      const sum = Number(t.sum) || 0;
      if(t.payment === 'Готівка') cash += sum;
      else if(t.payment === 'Безготівка') card += sum;
      else if(t.payment === 'Змішана'){ cash += Number(t.cashAmount) || 0; card += Number(t.cardAmount) || 0; }
      if(t.payment === 'Безкоштовно' || sum === 0) freeCount++;
      const pKey = String(t.payment || '').trim() || '(без оплати)';
      byPayment.set(pKey, {count:(byPayment.get(pKey) || {count:0}).count + 1, sum:round1((byPayment.get(pKey) || {sum:0}).sum + sum)});
      const tKey = String(t.type || '').trim() || '(без типу)';
      byType.set(tKey, {count:(byType.get(tKey) || {count:0}).count + 1, sum:round1((byType.get(tKey) || {sum:0}).sum + sum)});
      if(sum > best.sum) best = {date:t.date, address:compactAddress(t), sum, type:String(t.type || '')};
    }
    const signals = list.map(ticketSignalNumber).filter(function(n){ return n != null; });
    const signalStats = signals.length ? {
      parsed:signals.length,
      missing:list.length - signals.length,
      avg:round1(signals.reduce(function(s, n){ return s + n; }, 0) / signals.length),
      best:Math.max.apply(null, signals),
      worst:Math.min.apply(null, signals)
    } : {parsed:0, missing:list.length, avg:null, best:null, worst:null};
    const toRows = function(map){
      return Array.from(map.entries()).map(function(e){ return {key:e[0], count:e[1].count, sum:e[1].sum}; })
        .sort(function(a, b){ return b.sum - a.sum || b.count - a.count || a.key.localeCompare(b.key, 'uk'); });
    };
    const stats = {
      count:list.length,
      total:round1(total),
      cash_total:round1(cash),
      card_total:round1(card),
      free_count:freeCount,
      by_payment:toRows(byPayment),
      by_type:toRows(byType),
      signal:signalStats,
      most_expensive:list.length && best.sum > 0 ? best : null
    };
    if(resolvedItems.length) stats.item_totals = itemTotals(list, args);
    return stats;
  }
}
