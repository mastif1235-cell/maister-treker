/* Stage 2D: the phone's canonical AddressBook (Stage 2A) projected into KV.

   Transport: the PWA POSTs its directory projection to /directory (same
   bearer as /ask) whenever the local AddressBook changes; nothing here talks
   to DeepSeek and nothing here writes to Google Sheets/GAS — the READ tools
   only READ this key next to the ticket snapshot. The directory contains
   place names and their aliases only (no tickets, no clients, no phones).

   Storage: ONE key `mt:directory:v1` with the envelope
     {v:1, savedAt:<ms>, data:{cities:[...], streets:[...]}}
   City   = {id, name, aliases[], active, updatedAt}
   Street = {id, cityId, name, aliases[], active, updatedAt}

   Merge semantics: KV is the UNION of every phone's directory keyed by UUID.
   A second phone with its own directory (same or different UUIDs) can never
   erase the first one's identities; for one UUID the newer `updatedAt` wins
   (rename, alias, archive), the incoming copy wins a tie. Nothing is ever
   deleted here — archive is a flag, exactly as on the phone.

   Absence of the key (old deployments, phone never pushed, no KV binding)
   is the legacy state: every tool keeps its ticket-derived behaviour. */

export const DIRECTORY_VERSION = 1;

export function directoryKey(){
  return 'mt:directory:v' + DIRECTORY_VERSION;
}

export const DIRECTORY_LIMITS = {
  maxBodyBytes: 1048576,
  maxCities: 2000,
  maxStreets: 20000,
  maxName: 120,
  maxAliases: 40,
  maxAliasChars: 120,
  maxUpdatedAt: 40
};

/* Same identity shape as the ticket projection (mappers.js `ident`) and the
   app's link module: a directory id is a UUID or it is not an id at all. */
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function directoryId(value){
  const text = String(value == null ? '' : value);
  return ID_RE.test(text) ? text.toLowerCase() : '';
}

function isPlainObject(value){
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasUnsafeKeys(value, depth){
  if(depth > 6) return true;
  if(!value || typeof value !== 'object') return false;
  for(const key of Object.keys(value)){
    if(key === '__proto__' || key === 'prototype' || key === 'constructor') return true;
    if(hasUnsafeKeys(value[key], depth + 1)) return true;
  }
  return false;
}

function cleanName(value, max){
  if(typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanAliases(raw, name){
  if(!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set([name]);
  for(const value of raw){
    const alias = cleanName(value, DIRECTORY_LIMITS.maxAliasChars);
    if(!alias || seen.has(alias)) continue;
    seen.add(alias);
    out.push(alias);
    if(out.length >= DIRECTORY_LIMITS.maxAliases) break;
  }
  return out;
}

function cleanStamp(value){
  return typeof value === 'string' ? value.slice(0, DIRECTORY_LIMITS.maxUpdatedAt) : '';
}

function cleanEntity(raw, kind, seenIds){
  if(!isPlainObject(raw)) return null;
  const id = directoryId(raw.id);
  const name = cleanName(raw.name, DIRECTORY_LIMITS.maxName);
  if(!id || !name || seenIds.has(id)) return null;
  const entity = {id, name, aliases: cleanAliases(raw.aliases, name), active: raw.active !== false, updatedAt: cleanStamp(raw.updatedAt)};
  if(kind === 'street'){
    const cityId = directoryId(raw.cityId);
    if(!cityId || cityId === id) return null;
    entity.cityId = cityId;
  }
  seenIds.add(id);
  return entity;
}

/* Validates one incoming projection. Never throws; returns a stable code on
   a payload that is not a directory at all, and silently drops individual
   malformed entries (a hand-edited file must not poison the whole book). */
export function sanitizeDirectory(raw){
  if(!isPlainObject(raw) || hasUnsafeKeys(raw, 0)) return {ok:false, code:'INVALID_DIRECTORY'};
  if(Number(raw.v) !== DIRECTORY_VERSION) return {ok:false, code:'UNSUPPORTED_VERSION'};
  if(!Array.isArray(raw.cities) || !Array.isArray(raw.streets)) return {ok:false, code:'INVALID_DIRECTORY'};
  if(raw.cities.length > DIRECTORY_LIMITS.maxCities || raw.streets.length > DIRECTORY_LIMITS.maxStreets) return {ok:false, code:'DIRECTORY_TOO_LARGE'};
  const seenIds = new Set();
  const cities = [], streets = [];
  let dropped = 0;
  for(const row of raw.cities){
    const city = cleanEntity(row, 'city', seenIds);
    if(city) cities.push(city); else dropped++;
  }
  for(const row of raw.streets){
    const street = cleanEntity(row, 'street', seenIds);
    if(street) streets.push(street); else dropped++;
  }
  return {ok:true, data:{cities, streets}, dropped};
}

function newer(existing, incoming){
  /* ISO-8601 stamps compare lexicographically; a missing stamp never wins. */
  const a = String(existing && existing.updatedAt || '');
  const b = String(incoming && incoming.updatedAt || '');
  return b >= a ? incoming : existing;
}

/* UNION by UUID with per-entity last-writer-wins (see header). */
export function mergeDirectories(existing, incoming){
  const base = existing && Array.isArray(existing.cities) && Array.isArray(existing.streets) ? existing : {cities:[], streets:[]};
  const next = incoming && Array.isArray(incoming.cities) && Array.isArray(incoming.streets) ? incoming : {cities:[], streets:[]};
  const cities = new Map(), streets = new Map();
  for(const city of base.cities) cities.set(city.id, city);
  for(const street of base.streets) streets.set(street.id, street);
  for(const city of next.cities){
    streets.delete(city.id);
    cities.set(city.id, cities.has(city.id) ? newer(cities.get(city.id), city) : city);
  }
  for(const street of next.streets){
    cities.delete(street.id);
    streets.set(street.id, streets.has(street.id) ? newer(streets.get(street.id), street) : street);
  }
  return {cities: Array.from(cities.values()), streets: Array.from(streets.values())};
}

function parseEnvelope(raw){
  if(!raw) return null;
  let parsed = null;
  try{ parsed = JSON.parse(raw); }
  catch(_err){ return null; }
  if(!parsed || parsed.v !== DIRECTORY_VERSION || typeof parsed.savedAt !== 'number' || !parsed.data) return null;
  const cleaned = sanitizeDirectory({v:DIRECTORY_VERSION, cities:parsed.data.cities, streets:parsed.data.streets});
  if(!cleaned.ok) return null;
  return {savedAt: parsed.savedAt, data: cleaned.data};
}

/* KV-backed store. get() is memoised for a few seconds inside the isolate so
   one /ask turn (several tool calls) reads KV once; put() invalidates it. */
export function createDirectoryStore(options){
  const kv = (options && options.kv) || null;
  const now = (options && options.now) || Date.now;
  const log = (options && options.log) || function(){};
  const memoMs = options && options.memoMs != null ? Math.max(0, Number(options.memoMs) || 0) : 10000;
  let memo = null;

  async function readEnvelope(){
    if(!kv) return null;
    try{ return parseEnvelope(await kv.get(directoryKey())); }
    catch(_err){ log('directory_kv_read_failed'); return null; }
  }

  async function get(){
    if(!kv) return {available:false, reason:'no_kv'};
    if(memo && (now() - memo.at) <= memoMs) return memo.value;
    const envelope = await readEnvelope();
    const value = envelope
      ? {available:true, data:envelope.data, savedAt:envelope.savedAt}
      : {available:false, reason:'not_pushed'};
    memo = {at: now(), value};
    return value;
  }

  async function put(raw){
    const cleaned = sanitizeDirectory(raw);
    if(!cleaned.ok) return cleaned;
    if(!kv) return {ok:false, code:'KV_UNAVAILABLE'};
    const existing = await readEnvelope();
    const merged = mergeDirectories(existing ? existing.data : null, cleaned.data);
    const savedAt = now();
    try{ await kv.put(directoryKey(), JSON.stringify({v:DIRECTORY_VERSION, savedAt, data:merged})); }
    catch(_err){ log('directory_kv_write_failed'); return {ok:false, code:'KV_WRITE_FAILED'}; }
    memo = null;
    return {ok:true, cities:merged.cities.length, streets:merged.streets.length, dropped:cleaned.dropped, savedAt};
  }

  function invalidate(){ memo = null; }

  return {get, put, invalidate};
}
