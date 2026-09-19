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
   - a structured city already matching the catalog is authoritative and is
     NEVER overridden by notes or free text;
   - an incomplete legacy city is completed ONLY by evidence carried by that
     very SAME ROW: its own part number or ordinal («Миколаївка1», «первая»,
     «перша»), or its own street when the catalog knows that street AND
     exactly one numbered part of that name owns it. Evidence that lives in
     other rows is not evidence about this row — an incomplete «Миколаївка»
     row is NEVER moved into «Миколаївка 1» just because some OTHER
     «Миколаївка» row used a street of that part (there is deliberately no
     group/town-level assignment here);
   - ambiguity or conflicting evidence leaves the row unresolved AND flagged:
     it is never silently placed into a numbered part;
   - an unresolved row keeps its own spelling, so a question about the bare
     name («Миколаївка») still lists it (flagged as ambiguous — all parts),
     while a question about a numbered part never absorbs it. The tools
     additionally REPORT how many such rows stayed out, so the master can
     complete their city in the app;
   - `houses` in the places output is the set of distinct house values of a
     street, NOT a ticket count: one house may hold several tickets, so the
     address navigator's list of houses is never a list of tickets.

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

  /* Pass 2 — streets. Ownership evidence comes ONLY from rows whose own city
     IS canonical (that is what the master really chose from the list). Rows
     with an incomplete city contribute nothing at all: their streets must
     never be used to attribute anything to anybody. */
  for(const t of (tickets || [])){
    const city = String((t && t.city) || '').trim();
    const street = String((t && t.street) || '').trim();
    if(!city || !street) continue;
    const cityKey = placeIdentity(city);
    const streetKey = placeIdentity(street);
    if(!cityKey || !streetKey) continue;
    if(!canonicalKeys.has(cityKey)) continue;
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

  /* v91.48 (second revision): there is deliberately NO town/group-level
     assignment. An earlier draft pinned every row of an incomplete city
     («Миколаївка») to the part that some street of the group pointed at; that
     silently moved rows whose real part is unknown (and may even be «… 2»)
     into «… 1». Only per-row evidence may decide — see
     resolveCanonicalAddress. */

  return {cities, streetsByCity, streetOwners, citiesByLetters, canonicalKeys};
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
    out.canonical = true;
    return out;
  }

  const cityTokens = orderedPlaceTokens(structuredCity);
  const textTokens = legacyText ? orderedPlaceTokens(legacyText) : [];
  const streetEvidenceKey = out.streetKey || '';
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

  /* PER-ROW EVIDENCE ONLY. There is deliberately no "group anchor": the fact
     that some OTHER row with the same incomplete city («Миколаївка») carried
     a street of «Миколаївка 1» says NOTHING about this row — it may well
     belong to «Миколаївка 2». Such a row is never moved anywhere. */

  /* Rows with NO structured street at all: their OWN legacy text may name a
     street — that counts only when it names EXACTLY ONE street the user's
     catalog knows among the still-possible parts (two matching streets cancel
     each other out, unknown words never match anything). */
  let ownStreetKey = streetEvidenceKey;
  let ownStreetFromText = false;
  if(!ownStreetKey && textTokens.length && candidateKeys.size){
    const found = new Set();
    for(const key of candidateKeys){
      const streets = catalog.streetsByCity.get(key);
      if(!streets) continue;
      for(const [key2] of streets){
        const stems = key2.split('#')[0].split(' ').filter(Boolean);
        const present = stems.length && stems.every(function(stem){
          return textTokens.some(function(tok){
            return tok.letters.some(function(x){ return x === stem || x.startsWith(stem) || stem.startsWith(x); });
          });
        });
        if(present) found.add(key2);
      }
    }
    if(found.size === 1){ ownStreetKey = [...found][0]; ownStreetFromText = true; }
  }

  /* This row's OWN street: when the catalog knows it (it was recorded as a
     structured street of real tickets) and exactly ONE of the still-possible
     parts owns it, that is deterministic per-row evidence. A street the
     catalog has never seen is evidence of nothing — it must not wipe out an
     already-decided answer. A genuine CONFLICT (the street is known, but none
     of the remaining parts owns it) is not decided either: the row stays
     unresolved and flagged instead of being silently placed. */
  if(ownStreetKey && candidateKeys.size){
    const owners = catalog.streetOwners.get(ownStreetKey);
    if(owners && owners.size){
      const owning = [...candidateKeys].filter(function(k){ return owners.has(k); });
      if(owning.length === 1) candidateKeys = new Set(owning);
      else if(!owning.length){ candidateKeys = new Set(); out.ambiguous = true; }
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
      if(ownStreetKey && catalog.streetsByCity.has(key)){
        const match = catalog.streetsByCity.get(key).get(ownStreetKey);
        if(match){
          out.street = match.display;
          out.streetKey = ownStreetKey;
          if(ownStreetFromText && !String(t.street || '').trim()) out.via.street = 'legacy';
        }
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
     (of the row's own) selects one — keep raw values and flag it. */
  if(candidateKeys.size > 1) out.ambiguous = true;
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

/* The city a free-text query names, when the evidence is unambiguous. Used so
   a plain-text tool call («Николаевка первый» as a search query) resolves to
   exactly the same set as the structured one:
   - a numbered settlement, or a settlement that has no numbered parts at all
     («Таромське») → its canonical display;
   - a settlement named WITHOUT its part number and NOTHING else in the text
     («Николаевке», «Миколаївка») → the digitless display of that name, i.e.
     the question is about the whole name: the caller marks the answer
     ambiguous. This moves no row anywhere — each row still answers with its
     own resolved identity and the numbered parts only widen what is asked;
   - anything else (extra words, a street, a house) → '' and the ordinary text
     search decides, so «Миколаївка виноградная» is not reduced to a city. */
export function resolveCityFromText(text, catalog){
  const probe = {};
  const resolved = resolveCanonicalAddress(probe, String(text || ''), catalog);
  if(resolved && resolved.canonical) return resolved.city;
  return bareStemCityFromText(text, catalog);
}

/* «Миколаївка» (or «Николаевке») asked on its own: the text consists of the
   city name only and that name has numbered parts in the catalog → return the
   digitless display. Purely textual, no row is attributed to any part. */
function bareStemCityFromText(text, catalog){
  const tokens = orderedPlaceTokens(text).filter(function(tok){ return tok.letters.length || tok.digits.length; });
  if(!tokens.length) return '';
  if(tokens.some(function(tok){ return tok.digits.length; })) return '';
  for(const [lettersKey, keys] of catalog.citiesByLetters){
    const stems = lettersKey.split(' ').filter(Boolean);
    if(!stems.length || stems.length !== tokens.length) continue;
    const same = tokens.every(function(tok, i){
      return tok.letters.length === 1 && tok.letters[0] === stems[i];
    });
    if(!same) continue;
    const group = cityGroupDisplays(keys, catalog);
    if(group.numbered && group.digitless) return group.digitless;
  }
  return '';
}

/* Displays of one city-name group: the first digitless spelling and whether
   numbered parts of the same name exist. */
function cityGroupDisplays(keys, catalog){
  let digitless = '';
  let numbered = false;
  for(const k of (keys || [])){
    const c = catalog.cities.get(k);
    if(!c) continue;
    if(c.digits.length) numbered = true;
    else if(!digitless) digitless = c.display;
  }
  return {digitless, numbered};
}

/* The incomplete (digitless) spelling of a city NAME — «микола» → «Миколаївка»
   — but only when the same name also has numbered parts in the catalog
   (otherwise nothing is incomplete). Used to REPORT rows whose part number is
   missing from the data instead of hiding them. */
export function incompleteStemDisplay(catalog, lettersKey){
  const keys = catalog.citiesByLetters.get(String(lettersKey || ''));
  const group = cityGroupDisplays(keys, catalog);
  return group.numbered ? group.digitless : '';
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

/* Distinct canonical cities of a set of resolved addresses, sorted for
   display. A question about a name WITHOUT its part number that spans more
   than one city (or several parts of one name) is reported through this list —
   never silently collapsed into one part. */
export function distinctCanonicalCities(addresses){
  const map = new Map();
  for(const addr of (addresses || [])){
    const city = String((addr && addr.city) || '').trim();
    if(!city) continue;
    const key = placeIdentity(city) || city;
    if(!map.has(key)) map.set(key, city);
  }
  return Array.from(map.values()).sort(function(a, b){ return a.localeCompare(b, 'uk'); });
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
