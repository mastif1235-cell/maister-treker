/* Implementations of the READ-ONLY tools. Every tool derives its answer from
   the signed GAS reads; nothing here writes anywhere, and outputs are
   deterministic functions of the fetched data (no clock, no randomness). */

import {
  ticketFromGasRow, redactTicket, redactShift,
  ticketMatchesQuery, parseDateKey, searchableTextFromGasRow
} from '../gas/mappers.js';
import {
  extractPlaces, resolveAddress, normalizeHouse, cleanStr, normalizeStem, matchScore
} from '../ask/address.js';

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

function sortNewestFirst(list){
  return list.slice().sort(function(a, b){
    const ka = parseDateKey(a.date) || '';
    const kb = parseDateKey(b.date) || '';
    if(ka !== kb) return ka < kb ? 1 : -1;
    return String(a.time || '').localeCompare(String(b.time || ''));
  });
}

function round1(value){ return Math.round(value * 10) / 10; }

export function createReadTools(options){
  const gas = options.gas;
  /* data source: by default the direct redaction pipeline (no cache); when a
     snapshot provider is supplied (KV stage) it always returns the redacted
     projection too, so both paths are identical for the tools. */
  const data = options.data || createDataPipeline(gas);

  async function loadRedacted(){
    const result = await data.getList();
    if(!result.ok) return result;
    return {ok:true, tickets: result.data.tickets, shifts: result.data.shifts, searchIndex: Array.isArray(result.data.searchIndex) ? result.data.searchIndex : []};
  }

  function inRange(dateStr, from, to){
    const key = parseDateKey(dateStr);
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

  async function list_tickets(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    const from = params.date_from ? parseDateKey(params.date_from) : null;
    const to = params.date_to ? parseDateKey(params.date_to) : null;
    if((params.date_from && !from) || (params.date_to && !to)) return {ok:false, code:'INVALID_INPUT', message:'Некоректна дата (потрібен формат ДД.ММ.РРРР)'};
    const wantedTags = Array.isArray(params.tags) ? params.tags.slice() : null;
    const wantedType = params.type ? cleanStr(params.type) : null;

    let list = data.tickets.filter(function(t){
      if(!inRange(t.date, from, to)) return false;
      if(wantedTags && !wantedTags.some(function(tag){ return t.tags.includes(tag); })) return false;
      if(wantedType && cleanStr(t.type) !== wantedType) return false;

      if(params.signal_worse_than != null || params.signal_better_than != null){
        const sigText = String(t.signal == null ? '' : t.signal).trim();
        if(!sigText) return false;
        const numSignal = Number(sigText);
        if(!Number.isFinite(numSignal)) return false;
        if(params.signal_worse_than != null && numSignal > params.signal_worse_than) return false;
        if(params.signal_better_than != null && numSignal < params.signal_better_than) return false;
      }
      return true;
    });
    list = sortNewestFirst(list);
    const meta = page(list, params);
    return {ok:true, data:{tickets:list.slice(meta.offset, meta.offset + meta.limit), total_matched:meta.total_matched, returned:meta.returned, offset:meta.offset, limit:meta.limit}};
  }

  async function search_tickets(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    const from = params.date_from ? parseDateKey(params.date_from) : null;
    const to = params.date_to ? parseDateKey(params.date_to) : null;
    if((params.date_from && !from) || (params.date_to && !to)) return {ok:false, code:'INVALID_INPUT', message:'Некоректна дата (потрібен формат ДД.ММ.РРРР)'};
    let list = data.tickets.filter(function(t){
      if(!inRange(t.date, from, to)) return false;
      return ticketMatchesQuery(t, params.query);
    });
    list = sortNewestFirst(list);
    const meta = page(list, params);
    return {ok:true, data:{query:params.query, tickets:list.slice(meta.offset, meta.offset + meta.limit), total_matched:meta.total_matched, returned:meta.returned, offset:meta.offset, limit:meta.limit}};
  }

  async function list_places(params){
    const data = await loadRedacted();
    if(!data.ok) return data;
    let places = extractPlaces(data.tickets);
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

    const places = extractPlaces(data.tickets);
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
    const rStreetStem = normalizeStem(r.street);
    const rCityStem = r.city ? normalizeStem(r.city) : '';

    let list = data.tickets.filter(function(t){
      if(!inRange(t.date, from, to)) return false;
      if(rCityStem && t.city && normalizeStem(t.city) !== rCityStem && matchScore(t.city, r.city) < 0.75) return false;
      const tStreetStem = normalizeStem(t.street);
      if(tStreetStem !== rStreetStem && matchScore(t.street, r.street) < 0.75) return false;
      if(r.house && normalizeHouse(t.house) !== normalizeHouse(r.house)) return false;
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

  return {list_tickets, search_tickets, list_places, find_tickets_by_address, get_ticket, get_tickets_by_date, get_shifts, get_reports, get_statistics};
}
