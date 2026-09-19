/* Implementations of the READ-ONLY tools. Every tool derives its answer from
   the signed GAS reads; nothing here writes anywhere, and outputs are
   deterministic functions of the fetched data (no clock, no randomness). */

import {
  ticketFromGasRow, redactTicket, redactShift,
  ticketMatchesQuery, parseDateKey, searchableTextFromGasRow
} from '../gas/mappers.js';
import {
  extractPlaces, resolveAddress, normalizeHouse, cleanStr, normalizeStem, matchScore,
  placeIdentity, placeTokens, placeCompatible
} from '../ask/address.js';
import {
  buildCanonicalCatalog, resolveCanonicalAddress, cityFilterAccepts, cityStemAccepts,
  streetFilterAccepts, resolveCityFromText, distinctCanonicalCities
} from '../ask/canonical.js';
import {runSmartQuery, buildCatalogData, itemAttributesMatch, ticketDateKey, sortNewestFirst} from '../ask/smart-query.js';

/* Redaction pipeline: raw GAS rows -> whitelisted projections. This is the
   ONLY shape that travels to clients and (in the KV stage) into the cache. */
export function createDataPipeline(gas){
  return {
    async getList(){
      const result = await gas.getList();
      if(!result.ok) return result;
      const mapped = result.data.tickets.map(ticketFromGasRow);
      return {ok:true, data:{
        tickets: mapped.map(redactTicket),
        /* Internal-only derived search index. It is never returned by a tool;
           it lets address search use legacy notes without exposing them. */
        searchIndex: mapped.map(function(ticket){ return {id:ticket.id, text:ticket.searchableText}; }),
        shifts: result.data.shifts.map(redactShift)
      }};
    }
  };
}

/* Exact mirror of calculateTicketReportTotals (js/report-utils.js) — the same
   arithmetic the in-app report uses: «Безкоштовно» counts nowhere, «Змішана»
   splits into cashAmount/cardAmount. Parity is proven against the real module
   loaded from the app sources. */
export function calculateReportTotals(list){
  const tickets = list || [];
  const total = tickets.reduce(function(s, t){ return s + (Number(t.sum) || 0); }, 0);
  const cashTotal = tickets.reduce(function(s, t){
    return s + (t.payment === 'Готівка' ? (Number(t.sum) || 0) : t.payment === 'Змішана' ? (Number(t.cashAmount) || 0) : 0);
  }, 0);
  const cardTotal = tickets.reduce(function(s, t){
    return s + (t.payment === 'Безготівка' ? (Number(t.sum) || 0) : t.payment === 'Змішана' ? (Number(t.cardAmount) || 0) : 0);
  }, 0);
  return {count: tickets.length, total, cashTotal, cardTotal};
}

/* v91.48: ONE shared ordering for every READ tool: the smart-query engine's
   sortNewestFirst (date desc, then time desc, legacy-tolerant ticket date,
   deterministic id tie-break). It used to be duplicated here with an ascending
   time inside the day, which ordered the same list differently from
   query_tickets — now there is a single implementation to drift from. */


function round1(value){ return Math.round(value * 10) / 10; }

/* v91.48: places built from the CANONICAL effective address of every ticket
   (same resolver as query_tickets/list_tickets). Output shape is identical
   to address.js extractPlaces, so callers do not change — only now one real
   place never splits into «Миколаївка» + «Миколаївка 1» + «Миколаївка1». */
function buildCanonicalPlaces(tickets, searchIndex){
  const catalog = buildCanonicalCatalog(tickets);
  const legacyTextById = new Map((searchIndex || []).map(function(item){ return [String(item.id), String(item.text || '')]; }));
  const byCity = new Map();
  for(const t of (tickets || [])){
    const legacyText = legacyTextById.get(String(t.id)) || '';
    const addr = resolveCanonicalAddress(t, legacyText, catalog);
    const city = String(addr.city || '').trim();
    const street = String(addr.street || '').trim();
    if(!city && !street) continue;
    /* One real place may appear under several spellings («Миколаївка 1» /
       «Миколаївка1»); they merge into ONE entry only when the spellings are
       provably the same name (identity + surface compatibility). Two really
       different places that merely share a stem stay separate entries. */
    let cityLabel = null;
    for(const existing of byCity.keys()){
      if(existing === '(не вказано)') continue;
      if(placeIdentity(existing) === placeIdentity(city) && placeCompatible(existing, city)){ cityLabel = existing; break; }
    }
    if(!cityLabel) cityLabel = city || '(не вказано)';
    if(!byCity.has(cityLabel)) byCity.set(cityLabel, new Map());
    const streets = byCity.get(cityLabel);
    if(street){
      let streetKey = null;
      for(const existing of streets.keys()){
        if(placeIdentity(existing) === placeIdentity(street) && placeCompatible(existing, street)){ streetKey = existing; break; }
      }
      if(!streetKey) streetKey = street;
      if(!streets.has(streetKey)) streets.set(streetKey, {street: street, houses: new Set(), count: 0, variants: new Set()});
      const entry = streets.get(streetKey);
      /* ticket_count counts TICKETS; `houses` is the set of distinct house
         values of the street. One house may hold several tickets, so the
         navigator's house list is never a ticket count. */
      entry.count++;
      entry.variants.add(street);
      if(addr.house) entry.houses.add(String(addr.house).trim());
    }
  }
  const result = [];
  for(const [city, streets] of byCity){
    const list = [];
    let cityCount = 0;
    for(const [, entry] of streets){
      const houses = Array.from(entry.houses).sort(function(a, b){
        const na = parseInt(a, 10), nb = parseInt(b, 10);
        if(!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
        return a.localeCompare(b, 'uk');
      });
      cityCount += entry.count;
      list.push({street: entry.street, ticket_count: entry.count, houses, raw_variants: Array.from(entry.variants)});
    }
    result.push({
      city: city === '(не вказано)' ? '' : city,
      ticket_count: cityCount,
      streets: list.sort(function(a, b){ return b.ticket_count - a.ticket_count || a.street.localeCompare(b.street, 'uk'); })
    });
  }
  return result.sort(function(a, b){ return b.ticket_count - a.ticket_count || a.city.localeCompare(b.city, 'uk'); });
}

export function createReadTools(options){
  const gas = options.gas;
  /* data source: by default the direct redaction pipeline (no cache); when a
     snapshot provider is supplied (KV stage) it always returns the redacted
     projection too, so both paths are identical for the tools. */
  const data = options.data || createDataPipeline(gas);

  async function loadRedacted(){
    const result = await data.getList();
    if(!result.ok) return result;
    return {ok:true, tickets: result.data.tickets, shifts: result.data.shifts, searchIndex: Array.isArray(result.data.searchIndex) ? result.data.searchIndex : [],
      /* snapshot freshness (only when the KV snapshot stage is active) */
      savedAt: typeof result.savedAt === 'number' ? result.savedAt : null,
      snapshotCache: result.cache || null};
  }

  /* v91.48: a question about a name WITHOUT its part number spans every
     numbered part of that name. The set stays complete, but the parts are
     reported (exactly like query_tickets does) so the model asks the master to
     pick one instead of presenting several settlements as one place. */
  function bareStemParts(list, legacyTextById, catalog){
    const addresses = (list || []).map(function(ticket){
      return resolveCanonicalAddress(ticket, legacyTextById.get(String(ticket.id)) || '', catalog);
    });
    const parts = distinctCanonicalCities(addresses);
    return parts.length > 1 ? parts : [];
  }

  /* v91.48: ONE legacy-tolerant semantics for TICKET-side dates in every READ
     search path — the same ticketDateKey the smart-query engine uses
     («5.7.2026» → 2026-07-05). Without it query_tickets saw a legacy row while
     list_tickets/search_tickets/find_tickets_by_address silently lost it.
     The USER's date_from/date_to stay strict (parseDateKey above, validated
     per tool): only ticket data is parsed leniently, never user input.
     With NO filter at all a row is never dropped for its date format. */
  function inRange(dateStr, from, to){
    if(!from && !to) return true;
    const key = ticketDateKey(dateStr);
    if(!key) return false;
    if(from && key < from) return false;
    if(to && key > to) return false;
    return true;
  }

  function page(list, params){
    const limit = params.limit == null ? 50 : params.limit;
    const offset = params.offset || 0;
    return {total_matched: list.length, returned: list.slice(offset, offset + limit).length, offset, limit};
  }

  /* Aggregates are calculated from the complete filtered set, never from the
     paginated ticket page. They let COUNT/GROUP/UNIQUE questions remain exact
     without sending historical notes or dozens of full rows to the model. */
  function analytics(list){
    const cities = Object.create(null), streets = Object.create(null);
    for(const t of list){
      const city = String(t.city || '').trim() || 'Населений пункт не вказано';
      const street = String(t.street || t.address || '').trim() || 'Вулиця не вказана';
      cities[city] = (cities[city] || 0) + 1;
      streets[street] = (streets[street] || 0) + 1;
    }
    const groups = function(map){ return Object.keys(map).sort().map(function(name){ return {name, count:map[name]}; }); };
    return {unique_cities:groups(cities), unique_streets:groups(streets)};
  }

  function resultData(list, params, extra){
    const meta = page(list, params);
    return Object.assign({tickets:list.slice(meta.offset, meta.offset + meta.limit), total_matched:meta.total_matched, returned:meta.returned, offset:meta.offset, limit:meta.limit, analytics:analytics(list)}, extra || {});
  }

  async function list_tickets(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    const from = params.date_from ? parseDateKey(params.date_from) : null;
    const to = params.date_to ? parseDateKey(params.date_to) : null;
    if((params.date_from && !from) || (params.date_to && !to)) return {ok:false, code:'INVALID_INPUT', message:'Некоректна дата (потрібен формат ДД.ММ.РРРР)'};
    const wantedTags = Array.isArray(params.tags) ? params.tags.slice() : null;
    const wantedType = params.type ? cleanStr(params.type) : null;
    const wantedCity = params.city ? cleanStr(params.city).replace(/^(?:в|у|во)\s+/, '') : null;
    /* v91.48: the SAME canonical resolver query_tickets uses, so a count and
       a list can never disagree about which tickets belong to a city. */
    const catalog = buildCanonicalCatalog(data.tickets);
    const legacyTextById = new Map((data.searchIndex || []).map(function(item){ return [String(item.id), String(item.text || '')]; }));
    const cityMatches = function(ticket){
      if(!wantedCity) return true;
      const legacyText = legacyTextById.get(String(ticket.id)) || '';
      const addr = resolveCanonicalAddress(ticket, legacyText, catalog);
      return cityFilterAccepts(addr.city, wantedCity, legacyText) || cityStemAccepts(addr.city, wantedCity);
    };

    let list = data.tickets.filter(function(t){
      if(!inRange(t.date, from, to)) return false;
      if(!cityMatches(t)) return false;
      if(wantedTags && !wantedTags.some(function(tag){ return t.tags.includes(tag); })) return false;
      if(wantedType && cleanStr(t.type) !== wantedType) return false;

      if(params.signal_worse_than != null || params.signal_worse_or_equal != null || params.signal_better_than != null){
        const sigText = String(t.signal == null ? '' : t.signal).trim();
        if(!sigText) return false;
        const numSignal = Number(sigText);
        if(!Number.isFinite(numSignal)) return false;
        if(params.signal_worse_than != null && numSignal >= params.signal_worse_than) return false;
        if(params.signal_worse_or_equal != null && numSignal > params.signal_worse_or_equal) return false;
        if(params.signal_better_than != null && numSignal < params.signal_better_than) return false;
      }
      return true;
    });
    const bareParts = (wantedCity && !placeTokens(wantedCity).digits.length)
      ? bareStemParts(list, legacyTextById, catalog) : [];
    list = sortNewestFirst(list);
    const meta = page(list, params);
    return {ok:true, data:resultData(list, params, bareParts.length ? {
      ambiguous: true,
      candidates: bareParts.map(function(city){ return {city}; }),
      notes: ['Запит без номера частини охоплює кілька населених пунктів: ' + bareParts.join(', ') + '. Уточніть, який саме потрібен.']
    } : {})};
  }

  async function search_tickets(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    const from = params.date_from ? parseDateKey(params.date_from) : null;
    const to = params.date_to ? parseDateKey(params.date_to) : null;
    if((params.date_from && !from) || (params.date_to && !to)) return {ok:false, code:'INVALID_INPUT', message:'Некоректна дата (потрібен формат ДД.ММ.РРРР)'};
    const terms = Array.isArray(params.terms) ? params.terms.map(function(v){return String(v).trim();}).filter(Boolean) : [];
    const itemConditions = Array.isArray(params.item_conditions) ? params.item_conditions : [];
    const itemMatch = function(ticket, condition){
      const needle = cleanStr(condition.text);
      const pools = [{kind:'equipment',items:ticket.equipment||[]},{kind:'cable',items:ticket.cables||[]},{kind:'preset_work',items:ticket.presetWorks||[]},{kind:'additional_work',items:ticket.additionalWork||[]}];
      return pools.filter(function(pool){return !condition.kind || condition.kind === pool.kind;}).some(function(pool){ return pool.items.some(function(item){
        const label = cleanStr(item.label || item.desc);
        if(!label.includes(needle)) return false;
        /* Shared deterministic core with the smart-query engine: price/qty/
           total are bound to THIS item, never to a sibling work. */
        return itemAttributesMatch(item, condition);
      }); });
    };
    const extendedTermMatch = function(ticket, term){
      const q = cleanStr(term);
      const values = [].concat(ticket.note, ticket.abonentNote, ticket.otherNote, ticket.payment, ticket.street, ticket.house,
        (ticket.equipment || []).flatMap(function(e){return [e.label,e.price,e.qty,e.total];}),
        (ticket.cables || []).flatMap(function(c){return [c.label,c.meters,c.pricePerMeter];}),
        (ticket.presetWorks || []).flatMap(function(w){return [w.label,w.price,w.qty,w.total];}),
        (ticket.additionalWork || []).flatMap(function(w){return [w.desc,w.sum];}));
      return values.some(function(value){return cleanStr(value).includes(q);}) || ticketMatchesQuery(ticket, term);
    };
    /* v91.48: when the free-text query NAMES a city (the user's own catalog
       decides that, unambiguously), the tool resolves it exactly like
       query_tickets/list_tickets — same identity filters, same digit guard,
       same "bare name = all its numbered parts, flagged ambiguous" rule — so
       the answer never depends on which READ tool the model happened to pick.
       A bare name is resolved TEXTUALLY (no row is attributed to a part). */
    const catalog = buildCanonicalCatalog(data.tickets);
    const legacyTextById = new Map((data.searchIndex || []).map(function(item){ return [String(item.id), String(item.text || '')]; }));
    const queryCity = params.query ? resolveCityFromText(params.query, catalog) : '';
    const queryCityTokens = queryCity ? placeTokens(queryCity) : null;
    const queryCityIsBare = !!(queryCityTokens && !queryCityTokens.digits.length);
    /* NOTE: when the query names no city, the answer stays EXACTLY the app's
       own list predicate (mcp/test/integration/parity.test.js) — no extra
       legacy-text widening here. Address phrases such as «Миколаївка
       виноградная» belong to find_tickets_by_address, which resolves them
       from the address itself. */
    let list = data.tickets.filter(function(t){
      if(!inRange(t.date, from, to)) return false;
      if(params.sum_min != null && Number(t.sum) < Number(params.sum_min)) return false;
      if(params.sum_max != null && Number(t.sum) > Number(params.sum_max)) return false;
      if(params.payment && cleanStr(t.payment) !== cleanStr(params.payment)) return false;
      if(params.query){
        const legacyText = legacyTextById.get(String(t.id)) || '';
        const addr = resolveCanonicalAddress(t, legacyText, catalog);
        const hit = queryCity
          ? (cityFilterAccepts(addr.city, queryCity, legacyText) || cityStemAccepts(addr.city, queryCity))
          : ticketMatchesQuery(t, params.query);
        if(!hit) return false;
      }
      if(terms.length && !terms.every(function(term){ return extendedTermMatch(t, term); })) return false;
      if(itemConditions.length && !itemConditions.every(function(condition){ return itemMatch(t, condition); })) return false;
      return true;
    });
    /* A question about a name WITHOUT its part number legitimately spans every
       numbered part of that name; the set stays complete and is flagged
       exactly like query_tickets does (never silently collapsed into one
       part, never silently widened past the name). */
    const bareParts = queryCityIsBare ? bareStemParts(list, legacyTextById, catalog) : [];
    list = sortNewestFirst(list);
    const meta = page(list, params);
    return {ok:true, data:resultData(list, params, Object.assign({query:params.query, ambiguous:bareParts.length > 0},
      bareParts.length ? {candidates: bareParts.map(function(city){ return {city}; }),
        notes: ['Запит без номера частини охоплює кілька населених пунктів: ' + bareParts.join(', ') + '. Уточніть, який саме потрібен.']} : {}))};
  }

  async function list_places(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    let places = buildCanonicalPlaces(data.tickets, data.searchIndex);
    if(params && params.city){
      const qCity = cleanStr(params.city);
      places = places.filter(function(p){ return cleanStr(p.city).includes(qCity); });
    }
    return {ok:true, data:{places}};
  }

  async function find_tickets_by_address(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    const from = params.date_from ? parseDateKey(params.date_from) : null;
    const to = params.date_to ? parseDateKey(params.date_to) : null;
    if((params.date_from && !from) || (params.date_to && !to)) return {ok:false, code:'INVALID_INPUT', message:'Некоректна дата (потрібен формат ДД.ММ.РРРР)'};

    const places = buildCanonicalPlaces(data.tickets, data.searchIndex);
    const catalog = buildCanonicalCatalog(data.tickets);
    const legacyTextById = new Map((data.searchIndex || []).map(function(item){ return [String(item.id), String(item.text || '')]; }));
    const cityQuery = cleanStr(params.address).replace(/^(?:в|у|во)\s+/, '');
    /* v91.48: identity match first («Николаевка первый» → «Миколаївка 1»),
       historical score as the fallback. */
    const queryCityIdentity = placeIdentity(params.address);
    /* Exact identity first: a score-based rule must never OUTVOTE an exact
       match (otherwise «Миколаївка 1» collected «Миколаївка» as a second
       candidate and no city was resolved at all). Score stays the fallback
       for queries that match no catalog identity. */
    const exactCityCandidates = places.filter(function(place){
      const placeIdentityKey = placeIdentity(place.city);
      return !!(queryCityIdentity && placeIdentityKey && queryCityIdentity === placeIdentityKey);
    });
    const cityCandidates = exactCityCandidates.length ? exactCityCandidates : places.filter(function(place){
      return matchScore(place.city, cityQuery) >= 0.75;
    });
    if(cityCandidates.length === 1){
      const cityName = cityCandidates[0].city;
      let cityList = data.tickets.filter(function(t){
        if(!inRange(t.date, from, to)) return false;
        const legacyText = legacyTextById.get(String(t.id)) || '';
        const addr = resolveCanonicalAddress(t, legacyText, catalog);
        /* same predicate as query_tickets/list_tickets: identity first, then
           the explicit stem rule for a name given WITHOUT its part number */
        return cityFilterAccepts(addr.city, cityName, legacyText) || cityStemAccepts(addr.city, cityName);
      });
      cityList = sortNewestFirst(cityList);
      const cityMeta = page(cityList, params);
      /* A name WITHOUT its part number legitimately spans several numbered
         parts: report the alternatives instead of presenting them as one
         place (same rule as query_tickets/list_tickets). */
      const bareParts = placeTokens(cityName).digits.length ? [] : bareStemParts(cityList, legacyTextById, catalog);
      const bareAmbiguous = bareParts.length > 0;
      const bareCandidates = bareParts.map(function(city){ return {city}; });
      return {ok:true, data:{query:params.address, resolved:{city:cityName, street:null, house:null, confidence:1}, candidates:bareCandidates, ambiguous:bareAmbiguous, houses:[], tickets:cityList.slice(cityMeta.offset, cityMeta.offset + cityMeta.limit), total_matched:cityMeta.total_matched, returned:cityMeta.returned, offset:cityMeta.offset, limit:cityMeta.limit}};
    }
    const resolution = resolveAddress(params.address, places);
    const normalizeSearch = function(value){ return cleanStr(String(value || '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); };
    const queryText = normalizeSearch(params.address);
    const knownCityTokens = new Set(data.tickets.flatMap(function(t){ return normalizeSearch(t.city).split(/\s+/).filter(Boolean); }));
    const legacyQueryTokens = queryText.split(/\s+/).filter(function(token){ return token.length > 1 && !knownCityTokens.has(token); });
    const legacyIds = new Set(data.searchIndex.filter(function(item){
      const text = normalizeSearch(item && item.text);
      return item && item.id && legacyQueryTokens.length >= 1 && legacyQueryTokens.every(function(token){ return text.includes(token); });
    }).map(function(item){ return String(item.id); }));

    if(!resolution.resolved){
      if(legacyIds.size){
        const legacyList = data.tickets.filter(function(t){ return legacyIds.has(String(t.id)) && inRange(t.date, from, to); });
        const meta = page(legacyList, params);
        return {ok:true, data:{query:params.address, resolved:null, candidates:[], ambiguous:false, houses:[], tickets:legacyList.slice(meta.offset, meta.offset + meta.limit), total_matched:meta.total_matched, returned:meta.returned, offset:meta.offset, limit:meta.limit}};
      }
      return {
        ok:true,
        data:{
          query: params.address,
          resolved: null,
          candidates: resolution.candidates || [],
          ambiguous: !!resolution.ambiguous,
          houses: [],
          tickets: [],
          total_matched: 0,
          returned: 0,
          offset: 0,
          limit: params.limit || 50
        }
      };
    }

    const r = resolution.resolved;

    let list = data.tickets.filter(function(t){
      if(!inRange(t.date, from, to)) return false;
      const legacyText = legacyTextById.get(String(t.id)) || '';
      const addr = resolveCanonicalAddress(t, legacyText, catalog);
      if(r.city && !cityFilterAccepts(addr.city, r.city, legacyText)) return false;
      if(r.street && !streetFilterAccepts(addr.street, r.street)) return false;
      if(r.house && normalizeHouse(addr.house) !== normalizeHouse(r.house)) return false;
      return true;
    });

    list = sortNewestFirst(list);
    const meta = page(list, params);
    return {
      ok:true,
      data:{
        query: params.address,
        resolved: r,
        candidates: resolution.candidates || [],
        ambiguous: false,
        houses: resolution.houses || [],
        tickets: list.slice(meta.offset, meta.offset + meta.limit),
        total_matched: meta.total_matched,
        returned: meta.returned,
        offset: meta.offset,
        limit: meta.limit
      }
    };
  }

  async function get_ticket(params){
    const result = await gas.getTicketById(params.ticket_id);
    if(!result.ok) return result;
    const row = result.data.ticket;
    if(!row) return {ok:true, data:{found:false}};
    return {ok:true, data:{found:true, ticket:redactTicket(ticketFromGasRow(row))}};
  }

  /* Parity with ticketsForDate (js/tickets-domain.js): exact date string
     equality + sort by time ascending. */
  async function get_tickets_by_date(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    const list = data.tickets
      .filter(function(t){ return t.date === params.date; })
      .sort(function(a, b){ return String(a.time || '').localeCompare(String(b.time || '')); });
    return {ok:true, data:{date:params.date, count:list.length, tickets:list}};
  }

  async function get_shifts(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    const from = params.date_from ? parseDateKey(params.date_from) : null;
    const to = params.date_to ? parseDateKey(params.date_to) : null;
    if((params.date_from && !from) || (params.date_to && !to)) return {ok:false, code:'INVALID_INPUT', message:'Некоректна дата (потрібен формат ДД.ММ.РРРР)'};
    const wantedCoworker = params.coworker ? cleanStr(params.coworker) : null;

    let list = data.shifts
      .filter(function(s){
        const key = parseDateKey(s.date);
        if(!key) return false;
        if(from && key < from) return false;
        if(to && key > to) return false;
        if(wantedCoworker && !cleanStr(s.coworker).includes(wantedCoworker)) return false;
        return true;
      })
      .sort(function(a, b){
        const ka = parseDateKey(a.date) || '';
        const kb = parseDateKey(b.date) || '';
        if(ka !== kb) return ka < kb ? 1 : -1;
        return String(a.id).localeCompare(String(b.id));
      });
    const totalHours = round1(list.reduce(function(s, item){ return s + (Number(item.hours) || 0); }, 0));

    // Calculate coworker aggregates
    const coworkerMap = new Map();
    for(const s of list){
      const name = String(s.coworker || '').trim() || '(без напарника)';
      if(!coworkerMap.has(name)){
        coworkerMap.set(name, { coworker: name, count: 0, total_hours: 0, dates: [], last_date: s.date });
      }
      const entry = coworkerMap.get(name);
      entry.count += 1;
      entry.total_hours = round1(entry.total_hours + (Number(s.hours) || 0));
      entry.dates.push(s.date);
      const curKey = parseDateKey(s.date) || '';
      const lastKey = parseDateKey(entry.last_date) || '';
      if(curKey > lastKey) entry.last_date = s.date;
    }
    const byCoworker = Array.from(coworkerMap.values()).sort(function(a, b){
      return b.total_hours - a.total_hours || (a.coworker < b.coworker ? -1 : 1);
    });

    return {ok:true, data:{count:list.length, total_hours:totalHours, shifts:list, by_coworker:byCoworker}};
  }

  async function get_reports(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    const from = parseDateKey(params.date_from);
    const to = parseDateKey(params.date_to);
    if(!from || !to) return {ok:false, code:'INVALID_INPUT', message:'Некоректні дати (потрібен формат ДД.ММ.РРРР)'};
    const byDay = new Map();
    for(const t of data.tickets){
      const key = parseDateKey(t.date);
      if(!key || key < from || key > to) continue;
      if(!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(t);
    }
    const days = Array.from(byDay.keys()).sort().map(function(key){
      const dayList = byDay.get(key);
      return Object.assign(
        {date:key.split('-').reverse().join('.')},
        calculateReportTotals(dayList)
      );
    });
    return {ok:true, data:{date_from:params.date_from, date_to:params.date_to, days, totals:calculateReportTotals(byDay.size ? [].concat.apply([], Array.from(byDay.values())) : [])}};
  }

  /* Period windows mirror the in-app report ranges (js/report-utils.js):
     week = якір мінус 6 днів; month = календарний місяць якоря. */
  async function get_statistics(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    let anchorKey = params.anchor_date ? parseDateKey(params.anchor_date) : null;
    if(params.anchor_date && !anchorKey) return {ok:false, code:'INVALID_INPUT', message:'Некоректна anchor_date (потрібен формат ДД.ММ.РРРР)'};
    if(!anchorKey){
      const keys = data.tickets.map(function(t){ return parseDateKey(t.date); }).filter(Boolean);
      anchorKey = keys.length ? keys.sort()[keys.length - 1] : null;
    }
    let list = data.tickets.slice();
    let window = null;
    if(params.period !== 'all'){
      if(!anchorKey) return {ok:true, data:{period:params.period, anchor_date:null, window:null, totals:{count:0, total:0, cashTotal:0, cardTotal:0}, by_type:[], by_payment:[]}};
      const [y, m, d] = anchorKey.split('-').map(Number);
      const ref = new Date(y, m - 1, d);
      let start = ref, end = ref;
      if(params.period === 'week'){ start = new Date(ref); start.setDate(start.getDate() - 6); }
      else if(params.period === 'month'){ start = new Date(ref.getFullYear(), ref.getMonth(), 1); end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0); }
      const startKey = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');
      const endKey = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0');
      window = {date_from:startKey.split('-').reverse().join('.'), date_to:endKey.split('-').reverse().join('.')};
      list = list.filter(function(t){
        const key = parseDateKey(t.date);
        return !!key && key >= startKey && key <= endKey;
      });
    }
    const byType = new Map();
    const byPayment = new Map();
    for(const t of list){
      const typeKey = t.type || '';
      if(!byType.has(typeKey)) byType.set(typeKey, {count:0, total:0});
      const typeEntry = byType.get(typeKey);
      typeEntry.count += 1; typeEntry.total += Number(t.sum) || 0;
      const payKey = t.payment || '';
      if(!byPayment.has(payKey)) byPayment.set(payKey, {count:0, total:0});
      const payEntry = byPayment.get(payKey);
      payEntry.count += 1; payEntry.total += Number(t.sum) || 0;
    }
    const toRows = function(map){
      return Array.from(map.entries())
        .map(function(entry){ return {name:entry[0], count:entry[1].count, total:round1(entry[1].total)}; })
        .sort(function(a, b){ return b.total - a.total || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    };
    const totals = calculateReportTotals(list);
    return {ok:true, data:{period:params.period, anchor_date:anchorKey ? anchorKey.split('-').reverse().join('.') : null, window, totals, by_type:toRows(byType), by_payment:toRows(byPayment)}};
  }

  /* Universal deterministic smart-search engine (v91.44). Filtering,
     intersections, normalization, grouping, aggregation and pagination all
     happen HERE over the full dataset; the model only formats the result. */
  async function query_tickets(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    const ctx = {
      tickets: data.tickets,
      shifts: data.shifts,
      searchIndex: data.searchIndex,
      data_as_of: data.savedAt ? new Date(data.savedAt).toISOString() : null,
      snapshot_cache: data.snapshotCache
    };
    return runSmartQuery(ctx, params);
  }

  /* Compact catalog derived from ACTUAL ticket data (what was really used),
     so the model resolves natural-language item names against real labels. */
  async function list_catalog(){
    const data = await loadRedacted();
    if(!data.ok) return data;
    return {ok:true, data:buildCatalogData(data.tickets, data.shifts)};
  }

  return {list_tickets, search_tickets, query_tickets, list_catalog, list_places, find_tickets_by_address, get_ticket, get_tickets_by_date, get_shifts, get_reports, get_statistics};
}
