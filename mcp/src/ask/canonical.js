/* v91.48: canonical address resolution for the AI query path.

   WHY THIS EXISTS
   ===============
   The PWA shows historical tickets inside a user-created canonical city
   because the master assigned them there by hand: the address navigator
   groups tickets by their STRUCTURED city/street/house fields
   (js/address-render.js buildAddressTree + addrNavResultsAreaHtml — plain
   exact-string equality), and its footer says cloud tickets appear there
   only after the master fills city/street manually. So the canonical
   mapping is NOT a separate directory: it IS the user's own structured
   data (settings.cities + ticket.city/street/house written through
   fullDataJson / «ПовніДаніJSON:» lines).

   Historical Sheets rows often carry that structured data incompletely or
   in legacy spellings: a city without its part number («Миколаївка»
   instead of «Миколаївка 1»), RU spelling («Николаевка»), no-space form
   («Миколаївка1»), a textual ordinal («первая»/«перша»), or the address
   only inside free text («в Николаеве первой ул центральная дом не помню»).

   This module recovers such rows using ONLY the user's own catalog (the
   distinct structured city/street values present in the ticket base):

   - digit parts are IDENTITY: «Миколаївка 1» ≠ «Миколаївка 2» ≠ «… 10»;
   - different letter stems never merge («Новомиколаївка» ≠ «Миколаївка»);
   - an incomplete legacy city is completed only when the evidence points to
     EXACTLY ONE canonical city (street ownership and/or digit/ordinal); any
     ambiguity leaves the row unresolved rather than misplacing it;
   - a structured city already matching the catalog is authoritative and is
     NEVER overridden by notes or free text.

   Deterministic, pure, no I/O. Identity primitives live in address.js, so
   the tools, the /ask engine and the catalog share one definition. */

import {
  cleanStr, matchScore, effectiveAddressParts, placeTokens, placeIdentity, placeCompatible
} from './address.js';

/* Build the canonical catalog from the tickets themselves.
   - cities:          identity -> {display, count, letters, digits}
   - streetsByCity:   cityIdentity -> Map(streetIdentity -> {display, houses:Set, count})
   - streetOwners:    streetIdentity -> Set(cityIdentity)
   - citiesByLetters: joined letter stems -> Set(cityIdentity) */
const CATALOG_CACHE = new WeakMap();

export function buildCanonicalCatalog(tickets){
  if(tickets && typeof tickets === 'object' && CATALOG_CACHE.has(tickets)) return CATALOG_CACHE.get(tickets);
  const built = buildCanonicalCatalogUncached(tickets);
  if(tickets && typeof tickets === 'object') CATALOG_CACHE.set(tickets, built);
  return built;
}

function buildCanonicalCatalogUncached(tickets){
  const cities = new Map();
  const streetsByCity = new Map();
  const streetOwners = new Map();      /* canonical rows only — real evidence */
  const citiesByLetters = new Map();
  const cityVariants = new Map();
  const rowsByCityKey = new Map();

  /* Pass 1 — cities (identity, display variants, letter index). */
  for(const t of (tickets || [])){
    const city = String((t && t.city) || '').trim();
    if(!city) continue;
    const cityKey = placeIdentity(city);
    if(!cityKey) continue;
    const ct = placeTokens(city);
    let entry = cities.get(cityKey);
    if(!entry){
      entry = {display: city, count: 0, letters: ct.letters.join(' '), digits: ct.digits.slice()};
      cities.set(cityKey, entry);
    }
    entry.count++;
    if(!cityVariants.has(cityKey)) cityVariants.set(cityKey, new Map());
    const variants = cityVariants.get(cityKey);
    variants.set(city, (variants.get(city) || 0) + 1);
    if(!rowsByCityKey.has(cityKey)) rowsByCityKey.set(cityKey, []);
    rowsByCityKey.get(cityKey).push(t);
  }

  /* Deterministic display variant: most frequent spelling, then longest,
     then localeCompare — always a real value from the data. */
  for(const [cityKey, variants] of cityVariants){
    const best = [...variants.entries()].sort(function(a, b){
      return b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0], 'uk');
    })[0];
    if(best && cities.has(cityKey)) cities.get(cityKey).display = best[0];
  }

  /* Which identities are CANONICAL targets? A digitless spelling is an
     incomplete legacy form whenever a numbered part of the same letter
     stems exists in the same catalog («Миколаївка» is not a city when the
     master actually has «Миколаївка 1»). Digitless city with no numbered
     siblings («Таромське») stays canonical as itself. */
  const canonicalKeys = new Set();
  for(const [cityKey, entry] of cities){
    if(!citiesByLetters.has(entry.letters)) citiesByLetters.set(entry.letters, new Set());
    citiesByLetters.get(entry.letters).add(cityKey);
  }
  for(const [cityKey, entry] of cities){
    if(entry.digits.length) { canonicalKeys.add(cityKey); continue; }
    const siblings = citiesByLetters.get(entry.letters) || new Set();
    const numberedSibling = [...siblings].some(function(k){
      const c = cities.get(k);
      return c && c.digits.length;
    });
    if(!numberedSibling) canonicalKeys.add(cityKey);
  }

  /* Pass 2 — streets: ownership evidence comes ONLY from rows whose own city
     is canonical (that is what the master really chose from the list). Rows
     with an incomplete city contribute to their GROUP instead. */
  const groupStreets = new Map();   /* non-canonical cityKey -> Set(streetKey) */
  for(const t of (tickets || [])){
    const city = String((t && t.city) || '').trim();
    const street = String((t && t.street) || '').trim();
    if(!city || !street) continue;
    const cityKey = placeIdentity(city);
    const streetKey = placeIdentity(street);
    if(!cityKey || !streetKey) continue;
    if(!canonicalKeys.has(cityKey)){
      if(!groupStreets.has(cityKey)) groupStreets.set(cityKey, new Set());
      groupStreets.get(cityKey).add(streetKey);
      continue;
    }
    if(!streetsByCity.has(cityKey)) streetsByCity.set(cityKey, new Map());
    const sm = streetsByCity.get(cityKey);
    let se = sm.get(streetKey);
    if(!se){ se = {display: street, houses: new Set(), count: 0}; sm.set(streetKey, se); }
    se.count++;
    const house = String((t && t.house) || '').trim();
    if(house) se.houses.add(house);
    if(!streetOwners.has(streetKey)) streetOwners.set(streetKey, new Set());
    streetOwners.get(streetKey).add(cityKey);
  }

  /* Group anchors: an incomplete city group («Миколаївка» rows) is pinned to
     exactly one canonical part when at least one of its streets is owned by
     exactly one canonical city and no other candidate contradicts it. This
     is the ONLY way a bare stem may follow its evidence — and it stays a
     no-op the moment two parts are plausible. */
  const groupAnchors = new Map();
  for(const [groupKey, streetKeys] of groupStreets){
    const group = cities.get(groupKey);
    if(!group) continue;
    const candidateSet = new Set();
    for(const k of (citiesByLetters.get(group.letters) || [])) if(canonicalKeys.has(k)) candidateSet.add(k);
    if(!candidateSet.size) continue;
    const anchors = new Set();
    let contradiction = false;
    for(const streetKey of streetKeys){
      const owners = streetOwners.get(streetKey);
      if(!owners || !owners.size) continue;
      const inCandidates = [...owners].filter(function(o){ return candidateSet.has(o); });
      const outside = [...owners].filter(function(o){ return !candidateSet.has(o); });
      if(outside.length){ contradiction = true; }
      if(inCandidates.length === 1) anchors.add(inCandidates[0]);
      else if(inCandidates.length > 1) contradiction = true;
    }
    if(!contradiction && anchors.size === 1) groupAnchors.set(groupKey, [...anchors][0]);
  }

  return {cities, streetsByCity, streetOwners, citiesByLetters, canonicalKeys, groupStreets, groupAnchors};
}

/* Ordered token view of a free-text value: each token with the letters and
   digits it carries, so a city digit can be required to sit NEXT TO the city
   name («Миколаївка 1 вул Садова 7» → city digit 1, house digit 7 ignored)
   instead of any stray number in the text selecting a part by accident. */
function orderedPlaceTokens(value){
  const out = [];
  for(const raw of cleanStr(value).split(/[^\p{L}\p{N}]+/u)){
    if(!raw) continue;
    const t = placeTokens(raw);
    out.push({letters: t.letters, digits: t.digits});
  }
  return out;
}

/* Digits that qualify as the CITY's own part number inside a token stream:
   digits glued to a city-name token, or the token directly after it. */
function adjacentCityDigits(tokens, letters){
  const found = new Set();
  for(let i = 0; i < tokens.length; i++){
    const tok = tokens[i];
    const isCityToken = tok.letters.length && tok.letters.every(function(l){ return letters.indexOf(l) !== -1; });
    if(!isCityToken) continue;
    for(const d of tok.digits) found.add(d);
    const next = tokens[i + 1];
    if(next && next.digits.length && !next.letters.length) for(const d of next.digits) found.add(d);
  }
  return found;
}

/* Effective canonical address of ONE ticket.
   Returns {city, street, house, cityKey, streetKey, via, ambiguous}.
   via.city ∈ 'structured' | 'canonical-completed' | 'canonical-legacy' | 'legacy'. */
export function resolveCanonicalAddress(ticket, legacyText, catalog){
  const t = ticket || {};
  const eff = effectiveAddressParts(t, legacyText);
  const out = {
    city: eff.city,
    street: eff.street,
    house: eff.house,
    cityKey: placeIdentity(eff.city),
    streetKey: placeIdentity(eff.street),
    via: eff.via,
    ambiguous: false
  };

  const structuredCity = String(t.city || '').trim();
  if(structuredCity && catalog.canonicalKeys.has(out.cityKey)){
    out.via.city = out.via.city || 'structured';   /* canonical already — authoritative */
    return out;
  }

  const streetEvidenceKey = out.streetKey || '';
  const cityTokens = orderedPlaceTokens(structuredCity);
  const textTokens = legacyText ? orderedPlaceTokens(legacyText) : [];
  const structuredLetters = structuredCity ? placeTokens(structuredCity).letters : [];
  let candidateKeys = new Set();

  if(structuredCity){
    /* Incomplete/non-canonical structured city: every canonical city whose
       letter stems all appear in the row's own city value. */
    for(const [lettersKey, keys] of catalog.citiesByLetters){
      if(!lettersKey) continue;
      const stems = lettersKey.split(' ');
      const present = stems.every(function(stem){
        return structuredLetters.indexOf(stem) !== -1 ||
          structuredLetters.some(function(x){ return x.startsWith(stem) || stem.startsWith(x); });
      });
      if(!present) continue;
      for(const k of keys) if(catalog.canonicalKeys.has(k)) candidateKeys.add(k);
    }
    /* A digit next to the city name narrows to that part; digits elsewhere in
       the row (house numbers) never do. */
    if(candidateKeys.size > 1){
      const cityDigits = adjacentCityDigits(cityTokens, structuredLetters);
      if(cityDigits.size){
        const narrowed = [...candidateKeys].filter(function(k){
          const c = catalog.cities.get(k);
          return c && [...cityDigits].every(function(d){ return c.digits.indexOf(d) !== -1; });
        });
        if(narrowed.length) candidateKeys = new Set(narrowed);
      }
    }
  } else {
    /* No structured city at all: the row's own legacy text must carry the
       place. Same letters-first rule, digits only when adjacent to the name. */
    const lettersAll = [];
    for(const tok of textTokens) for(const l of tok.letters) lettersAll.push(l);
    for(const [lettersKey, keys] of catalog.citiesByLetters){
      if(!lettersKey) continue;
      const stems = lettersKey.split(' ');
      const present = stems.every(function(stem){
        return lettersAll.indexOf(stem) !== -1 ||
          lettersAll.some(function(x){ return x.startsWith(stem) || stem.startsWith(x); });
      });
      if(!present) continue;
      for(const k of keys) if(catalog.canonicalKeys.has(k)) candidateKeys.add(k);
    }
    if(candidateKeys.size > 1){
      const cityDigits = adjacentCityDigits(textTokens, lettersAll);
      if(cityDigits.size){
        const narrowed = [...candidateKeys].filter(function(k){
          const c = catalog.cities.get(k);
          return c && [...cityDigits].every(function(d){ return c.digits.indexOf(d) !== -1; });
        });
        if(narrowed.length) candidateKeys = new Set(narrowed);
      }
    }
  }

  /* GROUP ANCHOR: rows sharing one incomplete city value («Миколаївка») are
     one settlement's history. If one of their streets is owned by exactly one
     canonical part (evidence from rows whose city IS canonical), the whole
     group follows — unless some street of the group belongs to another part. */
  if(candidateKeys.size > 1){
    const groupKey = structuredCity ? out.cityKey : '';
    let anchorKey = groupKey ? catalog.groupAnchors.get(groupKey) : null;
    if(!anchorKey && !structuredCity){
      /* text-only row: the same anchor applies when the text carries a group
         key that itself has an anchor */
      for(const [key, anchor] of catalog.groupAnchors){
        const group = catalog.cities.get(key);
        if(!group) continue;
        const stems = group.letters.split(' ');
        const hasAll = stems.length && stems.every(function(stem){
          return textTokens.some(function(tok){ return tok.letters.indexOf(stem) !== -1; });
        });
        if(hasAll){ anchorKey = anchor; break; }
      }
    }
    if(anchorKey && candidateKeys.has(anchorKey)){
      const mismatch = streetEvidenceKey && (catalog.streetOwners.get(streetEvidenceKey) || new Set()).size &&
        !(catalog.streetOwners.get(streetEvidenceKey) || new Set()).has(anchorKey);
      if(!mismatch) candidateKeys = new Set([anchorKey]);
    }
  }

  /* Street ownership: with several parts still plausible, the row's street
     narrows them to the parts that actually own it. A street the canonical
     catalog has never seen is not evidence against anything — it must not
     wipe out an already-decided answer (only the single-candidate/anchor
     rules can decide then). */
  if(streetEvidenceKey && candidateKeys.size){
    const owners = catalog.streetOwners.get(streetEvidenceKey);
    if(owners && owners.size){
      candidateKeys = new Set([...candidateKeys].filter(function(k){ return owners.has(k); }));
    }
  }

  if(candidateKeys.size === 1){
    const key = [...candidateKeys][0];
    const c = catalog.cities.get(key);
    if(c){
      out.city = c.display;
      out.cityKey = key;
      out.canonical = true;
      out.via.city = structuredCity ? 'canonical-completed' : 'canonical-legacy';
      /* Street display: adopt the canonical spelling of that city only when
         the identity matches exactly ONE of its streets — two really
         different streets that merely share a stem stay separate. */
      if(streetEvidenceKey && catalog.streetsByCity.has(key)){
        const match = catalog.streetsByCity.get(key).get(streetEvidenceKey);
        if(match) out.street = match.display;
      }else if(!out.street && textTokens.length && catalog.streetsByCity.has(key)){
        /* Row without any structured street, but its legacy text names one:
           adopt it ONLY when the text matches exactly ONE street of the
           resolved city. Bounded by the user's own catalog — never a guess
           from arbitrary words. */
        const candidates = [];
        for(const [streetKey, se] of catalog.streetsByCity.get(key)){
          const stems = streetKey.split('#')[0].split(' ').filter(Boolean);
          const present = stems.length && stems.every(function(stem){
            return textTokens.some(function(tok){
              return tok.letters.some(function(x){ return x === stem || x.startsWith(stem) || stem.startsWith(x); });
            });
          });
          if(present) candidates.push(se);
        }
        if(candidates.length === 1){
          out.street = candidates[0].display;
          out.streetKey = placeIdentity(candidates[0].display);
          out.via.street = 'legacy';
        }
      }
      return out;
    }
  }
  /* Ambiguity never merges: several parts satisfy the evidence and nothing
     selects one — keep raw values and flag it. */
  if(candidateKeys.size > 1 && structuredCity) out.ambiguous = true;
  return out;
}

/* Does an effective (possibly recovered) city satisfy the requested city?
   Identity equality first — covers RU/UA, no-space, ordinal and inflected
   forms — then the historical matchScore fallback, always under the
   digit-part guard so «… 1» can never match «… 2» / «… 10». */
export function cityFilterAccepts(resolvedCity, wantedCity, legacyText){
  if(!wantedCity) return true;
  const wantedTokens = placeTokens(wantedCity);
  const wantedKey = placeIdentity(wantedCity);
  if(resolvedCity){
    const resolvedKey = placeIdentity(resolvedCity);
    const rTokens = placeTokens(resolvedCity);
    const digitConflict = (wantedTokens.digits.length && rTokens.digits.length &&
      wantedTokens.digits.join('#') !== rTokens.digits.join('#'));
    if(digitConflict) return false;
    /* A digitless value that STAYED digitless is an unresolved legacy row:
       it must not be pulled into a numbered part's answer by name similarity
       (that is exactly the silent widening the user forbids). */
    if(wantedTokens.digits.length && !rTokens.digits.length) return false;
    if(wantedKey && resolvedKey){
      /* One identity key: the two spellings must ALSO look like the same name
         (typo/inflection/RU↔UA). Similar-but-different derivations that merely
         share a stem are not fused, and no fuzzy score can rescue them. */
      if(wantedKey === resolvedKey) return placeCompatible(resolvedCity, wantedCity);
      return matchScore(resolvedCity, wantedCity) >= 0.72;
    }
    if(wantedTokens.letters.length && rTokens.letters.length &&
       wantedTokens.letters.join(' ') !== rTokens.letters.join(' ') &&
       (wantedTokens.digits.length || rTokens.digits.length)){
      /* different letter stems AND a part number involved: never fuzzy-merge */
      return false;
    }
    return matchScore(resolvedCity, wantedCity) >= 0.72;
  }
  /* No city at all on the ticket: token/stem search of its own legacy text
     (stems only, never substring), with the digit part required as a token. */
  if(!wantedTokens.letters.length) return false;
  const textTokens = placeTokens(legacyText);
  const lettersOk = wantedTokens.letters.every(function(stem){
    return textTokens.letters.indexOf(stem) !== -1 ||
      textTokens.letters.some(function(x){ return x.startsWith(stem) || stem.startsWith(x); });
  });
  if(!lettersOk) return false;
  return wantedTokens.digits.every(function(d){ return textTokens.digits.indexOf(d) !== -1; });
}

/* The canonical city a free-text query names, when the evidence is
   unambiguous. Used so a plain-text tool call («Николаевка первый» as a
   search query) resolves to exactly the same set as the structured one. */
export function resolveCityFromText(text, catalog){
  const probe = {};
  const resolved = resolveCanonicalAddress(probe, String(text || ''), catalog);
  return resolved && resolved.canonical ? resolved.city : '';
}

/* A city named WITHOUT its part number («Миколаївка») asks for the whole
   settlement name, so every numbered part that shares its letter stems
   answers — always flagged as ambiguous by the caller, never silently
   collapsed into one part. A query WITH a number is never widened. */
export function cityStemAccepts(resolvedCity, wantedCity){
  if(!resolvedCity || !wantedCity) return false;
  const wanted = placeTokens(wantedCity);
  if(wanted.digits.length || !wanted.letters.length) return false;
  const resolved = placeTokens(resolvedCity);
  if(!resolved.letters.length) return false;
  return wanted.letters.join(' ') === resolved.letters.join(' ');
}

/* Street filter with the same identity semantics as cities: canonical
   identity equality first («Вул Центральна» = «ул. Центральная» =
   «Центральна»), the historical score path second. */
export function streetFilterAccepts(resolvedStreet, wantedStreet){
  if(!wantedStreet) return true;
  if(!resolvedStreet) return false;
  const a = placeIdentity(resolvedStreet), b = placeIdentity(wantedStreet);
  if(a && b && a === b) return placeCompatible(resolvedStreet, wantedStreet);
  return matchScore(resolvedStreet, wantedStreet) >= 0.75;
}
