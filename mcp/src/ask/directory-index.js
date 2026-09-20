/* Stage 2D: in-memory index over the phone's AddressBook projection
   (data/directory.js) and the UUID-first resolver the READ tools share.

   Resolution is deterministic and conservative — no scoring, no guessing:
     tier 1  EXACT / ALIAS_EXACT  — the same spelling (placeExactKey) of the
                                    current name or of one explicit alias;
     tier 2  IDENTITY             — the SAME identity key the Stage 1 tools
                                    already use for ticket text (placeIdentity:
                                    UA↔RU bridges, cases, «вул./ул.»), so the
                                    Worker never becomes stricter than today;
     anything that matches several entities is AMBIGUOUS (candidates are
     reported, nothing is chosen); no match is NO_MATCH; empty is MALFORMED.
   Active entities win over archived ones (archived are still resolvable when
   they are the only match, so historical tickets stay findable).

   user text → name/alias → UUID;  then  UUID → tickets (cityId/streetId).
   Legacy tickets without ids keep the Stage 1 text path — see the callers. */

import {placeExactKey, placeIdentity} from './address.js';
import {directoryId} from '../data/directory.js';

function addKey(map, key, id){
  if(!key) return;
  if(!map.has(key)) map.set(key, new Set());
  map.get(key).add(id);
}

function keysOf(entity){
  const names = [entity.name].concat(Array.isArray(entity.aliases) ? entity.aliases : []);
  const exact = new Map(), identity = new Map();
  names.forEach(function(name, index){
    const e = placeExactKey(name), i = placeIdentity(name);
    if(e && !exact.has(e)) exact.set(e, index === 0 ? 'name' : 'alias');
    if(i && !identity.has(i)) identity.set(i, index === 0 ? 'name' : 'alias');
  });
  return {exact, identity};
}

/* data = {cities, streets} (already sanitized). */
export function buildDirectoryIndex(data){
  const cities = new Map(), streets = new Map(), streetsByCity = new Map();
  const cityExact = new Map(), cityIdentity = new Map(), streetExact = new Map(), streetIdentity = new Map();
  const list = data && Array.isArray(data.cities) && Array.isArray(data.streets) ? data : {cities:[], streets:[]};
  for(const raw of list.cities){
    const city = Object.assign({}, raw, {kind:'city', keys:keysOf(raw)});
    cities.set(city.id, city);
    for(const key of city.keys.exact.keys()) addKey(cityExact, key, city.id);
    for(const key of city.keys.identity.keys()) addKey(cityIdentity, key, city.id);
  }
  for(const raw of list.streets){
    const street = Object.assign({}, raw, {kind:'street', keys:keysOf(raw)});
    streets.set(street.id, street);
    if(!streetsByCity.has(street.cityId)) streetsByCity.set(street.cityId, []);
    streetsByCity.get(street.cityId).push(street);
    for(const key of street.keys.exact.keys()) addKey(streetExact, key, street.id);
    for(const key of street.keys.identity.keys()) addKey(streetIdentity, key, street.id);
  }
  return {available:true, cities, streets, streetsByCity, cityExact, cityIdentity, streetExact, streetIdentity,
    counts:{cities:cities.size, streets:streets.size}};
}

export function isDirectoryIndex(index){
  return !!(index && index.available && index.cities instanceof Map && index.streets instanceof Map);
}

function uniqueOrAmbiguous(entities, status){
  if(!entities.length) return null;
  if(entities.length === 1) return {status, entity:entities[0]};
  const active = entities.filter(function(e){ return e.active; });
  if(active.length === 1) return {status, entity:active[0]};
  return {status:'AMBIGUOUS', candidates:(active.length ? active : entities)};
}

/* Generic two-tier lookup over one entity Map with its exact/identity maps.
   `accept` narrows the candidate set (e.g. streets of one city). */
function lookup(entities, exactMap, identityMap, text, accept){
  const exactKey = placeExactKey(text);
  const identityKey = placeIdentity(text);
  if(!exactKey && !identityKey) return {status:'MALFORMED'};
  const pick = function(map, key){
    const ids = key && map.get(key);
    if(!ids) return [];
    const out = [];
    for(const id of ids){
      const entity = entities.get(id);
      if(entity && (!accept || accept(entity))) out.push(entity);
    }
    return out;
  };
  const exact = pick(exactMap, exactKey);
  if(exact.length){
    const hit = uniqueOrAmbiguous(exact, 'EXACT');
    if(hit.status === 'AMBIGUOUS') return hit;
    const viaAlias = hit.entity.keys.exact.get(exactKey) === 'alias';
    return {status: viaAlias ? 'ALIAS_EXACT' : 'EXACT', entity: hit.entity};
  }
  const identity = pick(identityMap, identityKey);
  if(identity.length){
    const hit = uniqueOrAmbiguous(identity, 'IDENTITY');
    return hit;
  }
  return {status:'NO_MATCH'};
}

function publicEntity(entity){
  if(!entity) return null;
  const out = {id:entity.id, name:entity.name, aliases:(entity.aliases || []).slice(), active:entity.active !== false};
  if(entity.kind === 'street') out.cityId = entity.cityId;
  return out;
}

export function resolveDirectoryCity(index, text){
  if(!isDirectoryIndex(index)) return {status:'NO_DIRECTORY'};
  const hit = lookup(index.cities, index.cityExact, index.cityIdentity, text, null);
  if(hit.status === 'AMBIGUOUS') return {status:'AMBIGUOUS', candidates:hit.candidates.map(publicEntity)};
  if(!hit.entity) return {status:hit.status};
  return {status:hit.status, cityId:hit.entity.id, city:publicEntity(hit.entity)};
}

/* cityId null → search every city; several streets of one name in different
   cities are AMBIGUOUS (the candidates carry their city names). */
export function resolveDirectoryStreet(index, cityId, text){
  if(!isDirectoryIndex(index)) return {status:'NO_DIRECTORY'};
  const scope = cityId ? function(street){ return street.cityId === cityId; } : null;
  const hit = lookup(index.streets, index.streetExact, index.streetIdentity, text, scope);
  if(hit.status === 'AMBIGUOUS'){
    return {status:'AMBIGUOUS', candidates:hit.candidates.map(function(street){
      const city = index.cities.get(street.cityId);
      return Object.assign(publicEntity(street), {city: city ? city.name : ''});
    })};
  }
  if(!hit.entity) return {status:hit.status};
  const city = index.cities.get(hit.entity.cityId) || null;
  return {status:hit.status, streetId:hit.entity.id, cityId:hit.entity.cityId, street:publicEntity(hit.entity), city:publicEntity(city)};
}

const RESOLVED = {EXACT:1, ALIAS_EXACT:1, IDENTITY:1};

export function isResolvedStatus(status){
  return !!RESOLVED[status];
}

/* Combined city+street resolution used by the ticket filters.
   Returns only what resolved UNIQUELY; the caller keeps the text path for
   the rest. A street given with an unresolved city is searched across all
   cities; a street given with a resolved city is scoped to it. */
export function resolveDirectoryPlace(index, cityText, streetText){
  const out = {cityId:null, streetId:null, city:null, street:null, cityStatus:null, streetStatus:null};
  if(!isDirectoryIndex(index)) return out;
  if(cityText){
    const city = resolveDirectoryCity(index, cityText);
    out.cityStatus = city.status;
    if(isResolvedStatus(city.status)){ out.cityId = city.cityId; out.city = city.city; }
    else if(city.status === 'AMBIGUOUS') out.cityCandidates = city.candidates;
  }
  if(streetText){
    const street = resolveDirectoryStreet(index, out.cityId, streetText);
    out.streetStatus = street.status;
    if(isResolvedStatus(street.status)){
      out.streetId = street.streetId;
      out.street = street.street;
      if(!out.cityId){ out.cityId = street.cityId; out.city = street.city; out.cityStatus = out.cityStatus || 'FROM_STREET'; }
    } else if(street.status === 'AMBIGUOUS') out.streetCandidates = street.candidates;
  }
  return out;
}

/* Which of a ticket's ids this directory actually knows. Unknown ids (another
   phone's directory, junk) are treated like a legacy row by the callers. */
export function knownTicketIds(index, ticket){
  if(!isDirectoryIndex(index) || !ticket) return {cityId:null, streetId:null};
  const cityId = directoryId(ticket.cityId), streetId = directoryId(ticket.streetId);
  return {
    cityId: cityId && index.cities.has(cityId) ? cityId : null,
    streetId: streetId && index.streets.has(streetId) ? streetId : null
  };
}

/* Read-only attribution of a LEGACY row (no usable ids) to a directory
   street: the same strict rule the app's Stage 2C linker applies (unique
   EXACT/ALIAS_EXACT/IDENTITY match of its own city and street text). Never
   persisted, never fuzzy — an ambiguous row stays a text-only row. */
export function attributeLegacyRow(index, city, street){
  if(!isDirectoryIndex(index) || !street) return null;
  if(city){
    /* the row names a city: it must resolve too, otherwise no attribution */
    const cityHit = resolveDirectoryCity(index, city);
    if(!isResolvedStatus(cityHit.status)) return null;
    const streetHit = resolveDirectoryStreet(index, cityHit.cityId, street);
    return isResolvedStatus(streetHit.status) ? {cityId:cityHit.cityId, streetId:streetHit.streetId} : null;
  }
  const streetHit = resolveDirectoryStreet(index, null, street);
  return isResolvedStatus(streetHit.status) ? {cityId:streetHit.cityId, streetId:streetHit.streetId} : null;
}

export function directoryCityName(index, cityId){
  const city = isDirectoryIndex(index) && cityId ? index.cities.get(cityId) : null;
  return city ? city.name : '';
}

export function directoryStreetName(index, streetId){
  const street = isDirectoryIndex(index) && streetId ? index.streets.get(streetId) : null;
  return street ? street.name : '';
}

/* All spellings the directory knows for one entity — current name first. */
export function directoryNames(index, kind, id){
  if(!isDirectoryIndex(index) || !id) return [];
  const entity = (kind === 'city' ? index.cities : index.streets).get(id);
  if(!entity) return [];
  return [entity.name].concat(entity.aliases || []);
}

/* DIRECTORY projection for the list_directory tool (public entity shape). */
export function directoryCities(index, includeArchived){
  if(!isDirectoryIndex(index)) return [];
  return Array.from(index.cities.values())
    .filter(function(city){ return includeArchived || city.active !== false; })
    .map(function(city){
      const streets = index.streetsByCity.get(city.id) || [];
      return Object.assign(publicEntity(city), {
        street_count: streets.filter(function(s){ return s.active !== false; }).length,
        archived_street_count: streets.filter(function(s){ return s.active === false; }).length
      });
    })
    .sort(function(a, b){ return a.name.localeCompare(b.name, 'uk'); });
}

export function directoryStreets(index, cityId, includeArchived){
  if(!isDirectoryIndex(index) || !cityId) return [];
  return (index.streetsByCity.get(cityId) || [])
    .filter(function(street){ return includeArchived || street.active !== false; })
    .map(publicEntity)
    .sort(function(a, b){ return a.name.localeCompare(b.name, 'uk'); });
}
