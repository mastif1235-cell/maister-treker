/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — безпечне відновлення локальної бази з Google Sheets.

   Читання з хмари — лише через наявний підписаний GET `list` (read-only).
   Перед застосуванням завжди створюється локальна pre-restore копія.
   Застосування йде через *LocalOnly-запис і вирівнювання sync snapshot,
   тому відновлені заявки/зміни НЕ потрапляють у sync journal і не
   відправляються повторно в Google Sheets.

   Частина 1 — чистий UMD-модуль без DOM/storage/network (тестується в Node).
   Частина 2 — browser runtime (модалки, fetch, backup, apply).
   ===================================================================== */
(function(root, factory){
  const api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  else root.MTRestoreFromSheets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  'use strict';

  function isPlainObject(value){
    if(!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function hasUnsafeKeys(value, depth){
    depth = Number(depth) || 0;
    if(depth > 24) return true;
    if(value === null || typeof value !== 'object') return false;
    for(const key of Object.keys(value)){
      if(key === '__proto__' || key === 'prototype' || key === 'constructor') return true;
      if(hasUnsafeKeys(value[key], depth + 1)) return true;
    }
    return false;
  }

  function stableStringify(value){
    if(Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if(value && typeof value === 'object'){
      const keys = Object.keys(value).sort();
      return '{' + keys.map(k=>JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function validateCloudListPayload(result){
    if(!result || typeof result !== 'object' || Array.isArray(result) || hasUnsafeKeys(result)){
      return {ok:false, code:'MALFORMED', reason:'хмара повернула небезпечний або пошкоджений обʼєкт'};
    }
    if(String(result.status || '') !== 'ok'){
      return {ok:false, code:String(result.code || 'SERVER_ERROR'), reason:'хмара не підтвердила читання'};
    }
    if(!Array.isArray(result.tickets) || !Array.isArray(result.shifts)){
      return {ok:false, code:'MALFORMED', reason:'у відповіді немає списків заявок/змін'};
    }
    const states = normalizeCloudStates(result.states);
    if(!states.ok) return {ok:false, code:'MALFORMED', reason:states.reason || 'пошкоджений блок states'};
    return {ok:true, tickets:result.tickets, shifts:result.shifts, states:states.present ? states.map : null};
  }

  // Bulk-ревізії з відповіді `list`. Новий сервер віддає states одним
  // читанням _SyncState, тому відновленню не потрібен getEntityState на кожен
  // запис. Відсутній блок = старий сервер => клієнт іде старим fallback.
  // Пошкоджений або небезпечний блок відхиляється цілком: без точних ревізій
  // відновлення не можна вважати безпечним.
  function normalizeCloudStates(states){
    if(states === undefined || states === null) return {ok:true, present:false, map:null};
    if(!isPlainObject(states) || hasUnsafeKeys(states)) return {ok:false, reason:'небезпечний блок states'};
    for(const key of Object.keys(states)){
      if(key !== 'ticket' && key !== 'shift') return {ok:false, reason:'невідомий ключ у states'};
    }
    if(!Array.isArray(states.ticket) || !Array.isArray(states.shift)) return {ok:false, reason:'states має містити списки заявок і змін'};
    const map = {ticket:new Map(), shift:new Map()};
    for(const key of ['ticket', 'shift']){
      const rows = states[key];
      for(const row of rows){
        if(!isPlainObject(row) || hasUnsafeKeys(row)) return {ok:false, reason:'пошкоджений запис states'};
        const id = typeof row.id === 'string' ? row.id : '';
        if(!id || id.length > 128) return {ok:false, reason:'некоректний id у states'};
        const revision = row.revision;
        if(typeof revision !== 'number' || !isFinite(revision) || revision < 0 || Math.floor(revision) !== revision || revision > 1000000000){
          return {ok:false, reason:'некоректна ревізія у states'};
        }
        if(typeof row.tombstone !== 'boolean') return {ok:false, reason:'некоректний tombstone у states'};
        if(map[key].has(id)) return {ok:false, reason:'дубль id у states'};
        map[key].set(id, {revision, tombstone:row.tombstone});
      }
    }
    return {ok:true, present:true, map};
  }

  // Будує baseline для журналу синхронізації з bulk-ревізій list, без мережі.
  // Запис без рядка в _SyncState отримує revision 0 — рівно те, що повернув би
  // getEntityState. Tombstone не імпортується: id потрапляє в skipCloud.
  function baselineFromStates(items, statesMap){
    const baselines = [];
    const skipCloud = {ticket:new Set(), shift:new Set()};
    (Array.isArray(items) ? items : []).forEach(item=>{
      const entity = item && (item.entity === 'ticket' || item.entity === 'shift') ? item.entity : '';
      const id = entity && item && item.id !== undefined && item.id !== null ? String(item.id) : '';
      if(!entity || !id) throw Object.assign(new Error('BAD_BASELINE_ITEM'), {code:'REVISION_FETCH_FAILED'});
      const bucket = (statesMap && statesMap[entity]) || new Map();
      const entry = bucket.get(id);
      if(entry && entry.tombstone){ skipCloud[entity].add(id); return; }
      baselines.push({entity, id, revision:entry ? entry.revision : 0, tombstone:false});
    });
    return {baselines, skipCloud};
  }

  function cloudTicketToLocal(row, deps){
    deps = deps || {};
    if(!row || typeof row !== 'object' || Array.isArray(row) || hasUnsafeKeys(row)){
      return {invalid:true, reason:'BAD_ROW', id:''};
    }
    const id = String(row.id || '').trim();
    if(!id) return {invalid:true, reason:'MISSING_ID', id:''};

    const blank = (typeof deps.blankTicketObject === 'function' ? deps.blankTicketObject() : {});
    const ticket = Object.assign({}, blank);
    ticket.id = id;
    ticket.date = String(row.date || '');
    ticket.time = String(row.time || '');
    ticket.content = String(row.content || '');
    ticket.sum = Number(row.sum) || 0;
    ticket.tags = Array.isArray(row.tags) ? row.tags.filter(tag=>typeof tag === 'string').slice() : [];
    ticket.photo = null;
    ticket.photos = [];
    ticket.cloudImported = true;

    let fullData = null;
    const rawJson = String(row.fullDataJson || '').trim();
    if(rawJson){
      try{
        const parsed = JSON.parse(rawJson);
        if(isPlainObject(parsed) && !hasUnsafeKeys(parsed)) fullData = parsed;
        else return {invalid:true, reason:'INVALID_FULL_DATA', id};
      }catch(_e){
        return {invalid:true, reason:'INVALID_JSON', id};
      }
    }

    const extra = (typeof deps.parseBackupNote === 'function' ? deps.parseBackupNote(String(row.backupNote || '')) : {geoLink:'',masterNote:'',login:'',password:'',fullData:null});

    if(fullData){
      Object.keys(fullData).forEach(key=>{ ticket[key] = fullData[key]; });
      if(!Object.prototype.hasOwnProperty.call(fullData, 'geoLink') && extra.geoLink) ticket.geoLink = extra.geoLink;
      if(!Object.prototype.hasOwnProperty.call(fullData, 'masterNote') && extra.masterNote) ticket.masterNote = extra.masterNote;
      if(!Object.prototype.hasOwnProperty.call(fullData, 'login') && extra.login) ticket.login = extra.login;
      if(!Object.prototype.hasOwnProperty.call(fullData, 'password') && extra.password) ticket.password = extra.password;
    }else{
      // legacy-рядок без повніДаніJSON: відновлюємо доступні поля з backupNote.
      if(isPlainObject(extra.fullData) && !hasUnsafeKeys(extra.fullData)){
        Object.keys(extra.fullData).forEach(key=>{ ticket[key] = extra.fullData[key]; });
      }
      ticket.geoLink = extra.geoLink || '';
      ticket.masterNote = extra.masterNote || '';
      ticket.login = extra.login || '';
      ticket.password = extra.password || '';
    }

    return {invalid:false, ticket};
  }

  function cloudShiftToLocal(row){
    if(!row || typeof row !== 'object' || Array.isArray(row) || hasUnsafeKeys(row)){
      return {invalid:true, reason:'BAD_ROW', id:''};
    }
    const id = String(row.id || '').trim();
    const date = String(row.date || '').trim();
    const hours = Number(row.hours);
    const coworker = String(row.coworker || 'Сам');
    if(!id) return {invalid:true, reason:'MISSING_ID', id:''};
    if(!/^\d{2}\.\d{2}\.\d{4}$/.test(date)) return {invalid:true, reason:'INVALID_DATE', id};
    if(!Number.isFinite(hours) || hours < 0 || hours > 48) return {invalid:true, reason:'INVALID_HOURS', id};
    return {invalid:false, shift:{id, date, hours, coworker}};
  }

  // Порівняння заявок/змін: нормалізуємо лише формат (порожнє значення, тип,
  // хвостові пробіли, формат дати/часу, порядок незначущих наборів), але не
  // сенс. Будь-яка реальна розбіжність значень лишається конфліктом.
  const COMPARABLE_UNORDERED_FIELDS = ['networkPointIds', 'diagnosticHistory'];

  function comparableFieldOptions(field){
    return COMPARABLE_UNORDERED_FIELDS.indexOf(String(field)) >= 0 ? {unordered:true} : null;
  }

  function padComparable(value){
    return (value < 10 ? '0' : '') + String(value);
  }

  function comparableDate(value){
    if(value && typeof value.getTime === 'function' && typeof value.getFullYear === 'function' && !isNaN(value.getTime())){
      return value.getFullYear() + '-' + padComparable(value.getMonth() + 1) + '-' + padComparable(value.getDate());
    }
    const text = String(value === undefined || value === null ? '' : value).trim();
    if(!text) return null;
    let match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if(match) return match[3] + '-' + padComparable(match[2]) + '-' + padComparable(match[1]);
    match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if(match) return match[1] + '-' + padComparable(match[2]) + '-' + padComparable(match[3]);
    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if(match) return match[3] + '-' + padComparable(match[2]) + '-' + padComparable(match[1]);
    return text;
  }

  function comparableTime(value){
    if(value && typeof value.getHours === 'function' && typeof value.getMinutes === 'function'){
      return padComparable(value.getHours()) + ':' + padComparable(value.getMinutes());
    }
    const text = String(value === undefined || value === null ? '' : value).trim();
    if(!text) return null;
    const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
    if(!match) return text;
    const hours = Number(match[1]);
    if(!(hours >= 0 && hours <= 23)) return text;
    return padComparable(hours) + ':' + match[2];
  }

  function comparableNumberText(text){
    const cleaned = text.replace(/\s+/g, '').replace(',', '.');
    if(!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function comparableContent(value){
    const text = String(value === undefined || value === null ? '' : value).replace(/[\s\u00a0]+$/, '');
    return text === '' ? null : text;
  }

  // Порожнє (немає ключа / null / '' / [] / {}) і нуль — те саме «порожньо»:
  // старі рядки не мали нових полів, і це не розбіжність даних.
  function comparableValue(value, options){
    const unordered = !!(options && options.unordered);
    if(value === undefined || value === null) return null;
    if(typeof value === 'number'){
      if(!Number.isFinite(value)) return String(value);
      return value === 0 ? null : value;
    }
    if(typeof value === 'boolean') return value === false ? null : value;
    if(typeof value === 'string'){
      const trimmed = value.trim();
      if(!trimmed) return null;
      const parsed = comparableNumberText(trimmed);
      if(parsed !== null) return parsed === 0 ? null : parsed;
      return trimmed;
    }
    if(Array.isArray(value)){
      const items = value.map(item=>comparableValue(item)).filter(item=>item !== null);
      if(!items.length) return null;
      return unordered ? items.map(item=>stableStringify(item)).sort() : items;
    }
    if(isPlainObject(value)){
      const result = {};
      Object.keys(value).sort().forEach(key=>{
        const normalized = comparableValue(value[key], comparableFieldOptions(key));
        if(normalized !== null) result[key] = normalized;
      });
      return Object.keys(result).length ? result : null;
    }
    return String(value);
  }

  function canonicalTicket(ticket, deps){
    deps = deps || {};
    const toPayload = (typeof deps.ticketToSyncPayload === 'function') ? deps.ticketToSyncPayload : function(t){
      return {id:t.id, date:t.date, time:t.time, content:t.content, sum:t.sum, tags:t.tags || [], backupNote:'', fullDataJson:''};
    };
    const p = toPayload(ticket) || {};
    // Пласкі поля берём из самой заявки: payload может подменить невалидную
    // дату/время на «сегодня», и это дало бы расхождение там, где данные те же.
    const source = ticket && typeof ticket === 'object' ? ticket : {};
    const pick = field=>{
      const raw = source[field];
      return raw === undefined || raw === null || raw === '' ? p[field] : raw;
    };
    let full = null;
    try{ full = JSON.parse(String(p.fullDataJson || '') || 'null'); }catch(_e){ full = null; }
    if(isPlainObject(full)){
      // geoLink — це локація, а не формат тексту: якщо з обох боків є
      // координати, довга/коротка ссылка сама по собі не є розбіжністю.
      const lat = comparableValue(full.geoLat);
      const lng = comparableValue(full.geoLng);
      if(typeof lat === 'number' && typeof lng === 'number') full.geoLink = 'coordinates';
    }
    const note = (typeof deps.parseBackupNote === 'function' ? deps.parseBackupNote(String(p.backupNote || '')) : null) || {};
    return stableStringify({
      id:String(pick('id') === undefined || pick('id') === null ? '' : pick('id')),
      date:comparableDate(pick('date')),
      time:comparableTime(pick('time')),
      content:comparableContent(pick('content')),
      sum:Number(pick('sum')) || 0,
      tags:comparableValue(Array.isArray(pick('tags')) ? pick('tags') : [], {unordered:true}),
      full:comparableValue(full),
      // backupNote не порівнюємо як рядок: він похідний від geoLink/masterNote
      // (вони вже в fullDataJson) і від login/password — саме їх і порівнюємо.
      login:comparableValue(note.login),
      password:comparableValue(note.password)
    });
  }

  function canonicalShift(shift){
    return stableStringify({
      id:String(shift === undefined || shift === null || shift.id === undefined || shift.id === null ? '' : shift.id),
      date:comparableDate(shift && shift.date),
      hours:Number(shift && shift.hours) || 0,
      coworker:comparableValue(shift && shift.coworker)
    });
  }

  function buildTicketPlan(local, cloudRows, deps){
    local = Array.isArray(local) ? local : [];
    cloudRows = Array.isArray(cloudRows) ? cloudRows : [];
    const localById = new Map();
    local.forEach(ticket=>{ const id = String(ticket.id || ''); if(id && !localById.has(id)) localById.set(id, ticket); });
    const seen = new Set();
    const items = [];
    const stats = {cloudCount:0, newCount:0, matchCount:0, conflictCount:0, invalidCount:0, localOnlyCount:0};

    cloudRows.forEach(row=>{
      const parsed = cloudTicketToLocal(row, deps);
      if(parsed.invalid){ stats.invalidCount++; items.push({kind:'invalid', id:parsed.id || '(без id)', reason:parsed.reason}); return; }
      const id = String(parsed.ticket.id);
      if(seen.has(id)){ stats.invalidCount++; items.push({kind:'invalid', id, reason:'DUPLICATE_ID'}); return; }
      seen.add(id);
      stats.cloudCount++;
      const localTicket = localById.get(id);
      if(!localTicket){ stats.newCount++; items.push({kind:'new', id, cloud:parsed.ticket}); return; }
      if(canonicalTicket(localTicket, deps) === canonicalTicket(parsed.ticket, deps)){
        stats.matchCount++; items.push({kind:'match', id});
      }else{
        stats.conflictCount++; items.push({kind:'conflict', id, local:localTicket, cloud:parsed.ticket});
      }
    });

    local.forEach(ticket=>{
      const id = String(ticket.id || '');
      if(id && !seen.has(id)){ stats.localOnlyCount++; items.push({kind:'local-only', id}); }
    });

    return {entity:'ticket', stats, items};
  }

  function buildShiftPlan(local, cloudRows){
    local = Array.isArray(local) ? local : [];
    cloudRows = Array.isArray(cloudRows) ? cloudRows : [];
    const localById = new Map();
    local.forEach(shift=>{ const id = String(shift.id || ''); if(id && !localById.has(id)) localById.set(id, shift); });
    const seen = new Set();
    const items = [];
    const stats = {cloudCount:0, newCount:0, matchCount:0, conflictCount:0, invalidCount:0, localOnlyCount:0};

    cloudRows.forEach(row=>{
      const parsed = cloudShiftToLocal(row);
      if(parsed.invalid){ stats.invalidCount++; items.push({kind:'invalid', id:parsed.id || '(без id)', reason:parsed.reason}); return; }
      const id = String(parsed.shift.id);
      if(seen.has(id)){ stats.invalidCount++; items.push({kind:'invalid', id, reason:'DUPLICATE_ID'}); return; }
      seen.add(id);
      stats.cloudCount++;
      const localShift = localById.get(id);
      if(!localShift){ stats.newCount++; items.push({kind:'new', id, cloud:parsed.shift}); return; }
      if(canonicalShift(localShift) === canonicalShift(parsed.shift)){
        stats.matchCount++; items.push({kind:'match', id});
      }else{
        stats.conflictCount++; items.push({kind:'conflict', id, local:localShift, cloud:parsed.shift});
      }
    });

    local.forEach(shift=>{
      const id = String(shift.id || '');
      if(id && !seen.has(id)){ stats.localOnlyCount++; items.push({kind:'local-only', id}); }
    });

    return {entity:'shift', stats, items};
  }

  function applyTicketPlan(local, cloudRows, decisions, deps, skipCloud){
    decisions = decisions || {};
    skipCloud = skipCloud || new Set();
    const localById = new Map();
    (Array.isArray(local) ? local : []).forEach(ticket=>localById.set(String(ticket.id), ticket));
    const imported = new Set();
    const out = [];
    (Array.isArray(cloudRows) ? cloudRows : []).forEach(row=>{
      const parsed = cloudTicketToLocal(row, deps);
      if(parsed.invalid) return;
      const id = String(parsed.ticket.id);
      if(imported.has(id)) return;
      const localTicket = localById.get(id);
      if(skipCloud.has(id)){
        // Хмарна сторона недоступна/видалена — не імпортуємо, але локальне не чіпаємо.
        if(localTicket) out.push(localTicket);
        imported.add(id);
        return;
      }
      if(!localTicket){ out.push(parsed.ticket); return; }
      imported.add(id);
      if(canonicalTicket(localTicket, deps) === canonicalTicket(parsed.ticket, deps)){ out.push(localTicket); return; }
      const decision = decisions[id] || 'local';
      if(decision === 'cloud') out.push(parsed.ticket);
      else out.push(localTicket); // 'local' або 'skip' — ніколи не видаляємо локальне автоматично
    });
    (Array.isArray(local) ? local : []).forEach(ticket=>{ if(!imported.has(String(ticket.id))) out.push(ticket); });
    return out;
  }

  function applyShiftPlan(local, cloudRows, decisions, skipCloud){
    decisions = decisions || {};
    skipCloud = skipCloud || new Set();
    const localById = new Map();
    (Array.isArray(local) ? local : []).forEach(shift=>localById.set(String(shift.id), shift));
    const imported = new Set();
    const out = [];
    (Array.isArray(cloudRows) ? cloudRows : []).forEach(row=>{
      const parsed = cloudShiftToLocal(row);
      if(parsed.invalid) return;
      const id = String(parsed.shift.id);
      if(imported.has(id)) return;
      const localShift = localById.get(id);
      if(skipCloud.has(id)){
        if(localShift) out.push(localShift);
        imported.add(id);
        return;
      }
      if(!localShift){ out.push(parsed.shift); return; }
      imported.add(id);
      if(canonicalShift(localShift) === canonicalShift(parsed.shift)){ out.push(localShift); return; }
      const decision = decisions[id] || 'local';
      if(decision === 'cloud') out.push(parsed.shift);
      else out.push(localShift);
    });
    (Array.isArray(local) ? local : []).forEach(shift=>{ if(!imported.has(String(shift.id))) out.push(shift); });
    return out;
  }

  function defaultDecisions(plan, choice){
    const decisions = {};
    (plan && plan.items ? plan.items : []).forEach(item=>{
      if(item.kind === 'conflict') decisions[item.id] = choice === 'cloud' ? 'cloud' : 'local';
    });
    return decisions;
  }

  // Які сутності потрібно «привʼязати» до серверної revision: усі записи, які
  // є в хмарі — нові, однакові та конфлікти, незалежно від рішення по
  // конфлікту. Рішення визначає лише контент; baseline завжди має дорівнювати
  // серверній ревізії, інакше наступна локальна правка втрапить у STALE.
  function baselineRequests(plan){
    const requests = [];
    if(!plan || !Array.isArray(plan.items)) return requests;
    plan.items.forEach(item=>{
      if(item.kind === 'new' || item.kind === 'match' || item.kind === 'conflict'){ requests.push({entity:plan.entity, id:item.id}); }
    });
    return requests;
  }

  // Локальний запис, який на сервері вже видалено (tombstone). Такий запис не
  // імпортується, не видаляється локально і не пересоздається. Baseline
  // вирівнюється під серверну ревізію без tombstone-прапорця: наступна правка
  // піде як update на revision+1, сервер відповість TOMBSTONED (delete-wins), а
  // клієнт паркує цю відповідь як явний конфлікт. Тому немає ні retry-циклу,
  // ні мовчазної втрати правки.
  function tombstonedLocalBaselines(items, statesMap){
    const baselines = [];
    const seen = new Set();
    (Array.isArray(items) ? items : []).forEach(item=>{
      const entity = item && (item.entity === 'ticket' || item.entity === 'shift') ? item.entity : '';
      const id = entity && item && item.id !== undefined && item.id !== null ? String(item.id) : '';
      if(!entity || !id) return;
      const key = entity + ':' + id;
      if(seen.has(key)) return;
      const bucket = statesMap && statesMap[entity];
      const entry = bucket && typeof bucket.get === 'function' ? bucket.get(id) : null;
      if(!entry || !entry.tombstone) return;
      seen.add(key);
      baselines.push({entity, id, revision:Number(entry.revision) || 0, tombstone:false});
    });
    return {baselines};
  }

  return {
    isPlainObject,
    hasUnsafeKeys,
    stableStringify,
    validateCloudListPayload,
    normalizeCloudStates,
    cloudTicketToLocal,
    cloudShiftToLocal,
    canonicalTicket,
    canonicalShift,
    buildTicketPlan,
    buildShiftPlan,
    applyTicketPlan,
    applyShiftPlan,
    defaultDecisions,
    baselineRequests,
    baselineFromStates,
    tombstonedLocalBaselines
  };
});


/* =====================================================================
   Browser runtime. Усі залежності читаються в момент виклику (не на етапі
   завантаження), тому порядок підключення безпечний.
   ===================================================================== */
if(typeof window !== 'undefined'){
  const MT_RESTORE_BACKUP_PREFIX = 'pre-restore-';

  function mtRestoreDeps(){
    return {
      blankTicketObject: typeof blankTicketObject === 'function' ? blankTicketObject : (()=>({})),
      parseBackupNote: typeof parseBackupNote === 'function' ? parseBackupNote : (()=>({geoLink:'',masterNote:'',login:'',password:'',fullData:null})),
      ticketToSyncPayload: typeof ticketToSyncPayload === 'function' ? ticketToSyncPayload : null
    };
  }

  function mtRestoreShortText(value, max){
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  function mtRestoreCloudError(code){
    const map = {
      AUTH_FAILED:'Сервер відхилив підпис — перевірте HMAC-ключ у Налаштуваннях і в Apps Script.',
      NETWORK:'Немає звʼязку з сервером. Локальну базу не змінено.',
      BUSY:'Сервер зайнятий — спробуйте ще раз за кілька секунд.',
      SERVER_ERROR:'Сервер не зміг прочитати дані — переконайтесь, що таблиці заявок і змін налаштовані.',
      MALFORMED:'Хмара повернула пошкоджену відповідь. Локальну базу не змінено.',
      INVALID_INPUT:'Сервер відхилив запит. Локальну базу не змінено.'
    };
    showToast(map[code] || 'Не вдалося отримати дані з Google Sheets. Локальну базу не змінено.');
  }

  function mtRestorePlanStatsText(label, stats){
    const s = stats || {};
    const deleted = Number(s.cloudDeletedLocalCount) || 0;
    return `${label}: у хмарі ${s.cloudCount || 0}, нових ${s.newCount || 0}, збігається ${s.matchCount || 0}, конфліктів ${s.conflictCount || 0}, пошкоджених ${s.invalidCount || 0}, лише локально ${s.localOnlyCount || 0}${deleted ? `, видалених у хмарі ${deleted} (лишаються локально)` : ''}`;
  }

  function mtRestoreTicketConflictLabel(item){
    const local = item.local || {}, cloud = item.cloud || {};
    const title = [local.date || cloud.date, local.time || cloud.time, local.clientName || cloud.clientName || local.type || cloud.type].filter(Boolean).join(' ');
    const localText = mtRestoreShortText(local.content || cloud.content || '', 120);
    const cloudText = mtRestoreShortText(cloud.content || local.content || '', 120);
    return `<div class="rc-title">${escapeHtml(title || item.id)}</div><div class="rc-sub">Локально: ${escapeHtml(localText)}</div><div class="rc-sub">Хмара: ${escapeHtml(cloudText)}</div>`;
  }

  function mtRestoreShiftConflictLabel(item){
    const local = item.local || {}, cloud = item.cloud || {};
    return `<div class="rc-title">Зміна ${escapeHtml(local.date || cloud.date || item.id)}</div><div class="rc-sub">Локально: ${Number(local.hours) || 0} год · ${escapeHtml(local.coworker || '')}</div><div class="rc-sub">Хмара: ${Number(cloud.hours) || 0} год · ${escapeHtml(cloud.coworker || '')}</div>`;
  }

  function mtShowRestoreAnalysis(scope, ticketPlan, shiftPlan){
    return new Promise(resolve=>{
      const rows = [];
      if(ticketPlan) rows.push(mtRestorePlanStatsText('Заявки', ticketPlan.stats));
      if(shiftPlan) rows.push(mtRestorePlanStatsText('Зміни', shiftPlan.stats));
      const body = `
        <div style="font-size:14px; line-height:1.5; margin-bottom:10px;">Дані прочитано з Google Sheets без зміни локальної бази. Далі ви побачите конфлікти (якщо є) і підтвердження.</div>
        <div class="report-text">${rows.map(r=>escapeHtml(r)).join('<br>')}</div>
        <div style="font-size:12.5px; color:var(--text-dim); margin-top:10px;">Не відновлюються з Sheets: фото (лише з Telegram/пристрою), Telegram-стан і message_id, локальні налаштування, чернетки, кошик, мережеві точки, діагностика та офлайн-карти.</div>
        <div class="row" style="gap:8px; margin-top:14px;">
          <button type="button" class="btn btn-block" data-modal-cancel>Скасувати</button>
          <button type="button" class="btn btn-accent btn-block" id="mtRestoreAnalysisProceed">Продовжити</button>
        </div>`;
      let settled = false;
      const finish = value=>{ if(settled) return; settled = true; resolve(value); };
      openModal('Відновлення з Google Sheets', body, {
        onOpen: bodyEl=>{
          bodyEl.querySelector('#mtRestoreAnalysisProceed').onclick = ()=>{ finish(true); closeModal(); };
          bodyEl.querySelector('[data-modal-cancel]').onclick = ()=>{ finish(false); closeModal(); };
        },
        onClose: ()=>{ finish(false); closeModal(); }
      });
    });
  }

  function mtCollectRestoreDecisions(ticketPlan, shiftPlan){
    const conflicts = [];
    if(ticketPlan) ticketPlan.items.filter(item=>item.kind === 'conflict').forEach(item=>conflicts.push({type:'ticket', item}));
    if(shiftPlan) shiftPlan.items.filter(item=>item.kind === 'conflict').forEach(item=>conflicts.push({type:'shift', item}));
    if(!conflicts.length) return Promise.resolve({cancelled:false, tickets:{}, shifts:{}});

    return new Promise(resolve=>{
      const decisions = {tickets:{}, shifts:{}};
      const rows = conflicts.map((entry, index)=>{
        const label = entry.type === 'ticket' ? mtRestoreTicketConflictLabel(entry.item) : mtRestoreShiftConflictLabel(entry.item);
        return `<div class="restore-conflict-row" data-idx="${index}" data-type="${entry.type}" data-id="${escapeHtml(entry.item.id)}">
          ${label}
          <div class="row wrap" style="gap:6px; margin-top:6px;">
            <button type="button" class="btn btn-sm rc-choice" data-choice="local">Локальна</button>
            <button type="button" class="btn btn-sm btn-accent rc-choice" data-choice="cloud">Хмарна</button>
            <button type="button" class="btn btn-sm btn-ghost rc-choice" data-choice="skip">Пропустити</button>
          </div>
        </div>`;
      }).join('');
      const body = `
        <div style="font-size:13px; color:var(--text-dim); margin-bottom:8px;">Однакові ID, але різні дані. Оберіть версію для кожного запису або застосуйте до всіх. Автоматично нічого не перезаписується.</div>
        <div class="row wrap" style="gap:6px; margin-bottom:10px;">
          <button type="button" class="btn btn-sm btn-accent" id="mtRestoreAllCloud">Хмара для всіх</button>
          <button type="button" class="btn btn-sm" id="mtRestoreAllLocal">Локальні для всіх</button>
        </div>
        <div id="mtRestoreConflictList" style="max-height:52vh; overflow:auto; display:flex; flex-direction:column; gap:10px;">${rows}</div>
        <div class="row" style="gap:8px; margin-top:12px;">
          <button type="button" class="btn btn-block" data-modal-cancel>Скасувати</button>
          <button type="button" class="btn btn-accent btn-block" id="mtRestoreConflictApply" disabled>Далі</button>
        </div>`;
      let settled = false;
      const finish = value=>{ if(settled) return; settled = true; resolve(value); };
      const choiceFor = {};
      openModal(`Конфлікти (${conflicts.length})`, body, {
        onOpen: bodyEl=>{
          const listEl = bodyEl.querySelector('#mtRestoreConflictList');
          const applyBtn = bodyEl.querySelector('#mtRestoreConflictApply');
          const setChoice = (row, choice)=>{
            const idx = row.dataset.idx;
            choiceFor[idx] = choice;
            row.querySelectorAll('.rc-choice').forEach(btn=>btn.classList.toggle('active', btn.dataset.choice === choice));
            applyBtn.disabled = conflicts.some((_entry, i)=>!choiceFor[i]);
          };
          listEl.querySelectorAll('.restore-conflict-row').forEach(row=>{
            row.querySelectorAll('.rc-choice').forEach(btn=>{ btn.onclick = ()=>setChoice(row, btn.dataset.choice); });
          });
          bodyEl.querySelector('#mtRestoreAllCloud').onclick = ()=>listEl.querySelectorAll('.restore-conflict-row').forEach(row=>setChoice(row, 'cloud'));
          bodyEl.querySelector('#mtRestoreAllLocal').onclick = ()=>listEl.querySelectorAll('.restore-conflict-row').forEach(row=>setChoice(row, 'local'));
          applyBtn.onclick = ()=>{
            conflicts.forEach((entry, index)=>{
              const choice = choiceFor[index] || 'local';
              const bucket = entry.type === 'ticket' ? decisions.tickets : decisions.shifts;
              bucket[entry.item.id] = choice;
            });
            finish({cancelled:false, tickets:decisions.tickets, shifts:decisions.shifts});
            closeModal();
          };
          bodyEl.querySelector('[data-modal-cancel]').onclick = ()=>{ finish({cancelled:true}); closeModal(); };
        },
        onClose: ()=>{ finish({cancelled:true}); closeModal(); }
      });
    });
  }

  function mtBuildRestoreSummary(scope, ticketPlan, shiftPlan, decisions){
    const parts = [];
    if(ticketPlan) parts.push(mtRestorePlanStatsText('Заявки', ticketPlan.stats));
    if(shiftPlan) parts.push(mtRestorePlanStatsText('Зміни', shiftPlan.stats));
    const takeCloud = (decisions.tickets ? Object.values(decisions.tickets).filter(v=>v === 'cloud').length : 0) +
      (decisions.shifts ? Object.values(decisions.shifts).filter(v=>v === 'cloud').length : 0);
    parts.push(`Конфліктів взяти з хмари: ${takeCloud}`);
    parts.push('Перед застосуванням буде створено локальну резервну копію поточного стану.');
    return parts.join('\n');
  }

  function mtBaselineCodeRetryable(code){
    return code === 'NETWORK' || code === 'BUSY';
  }

  async function mtFetchEntityBaseline(transport, entity, id, opts){
    const maxRetries = (opts && Number(opts.maxRetries)) || 2;
    let lastError = null;
    for(let attempt = 0; attempt <= maxRetries; attempt++){
      let response;
      try{
        response = await transport.getEntityState(entity, id);
      }catch(error){
        lastError = {code:'NETWORK', retryable:true, error};
        continue;
      }
      if(response && response.ok && response.result && response.result.status === 'ok' && response.result.state){
        const st = response.result.state;
        return {entity, id, revision:Number(st.revision) || 0, tombstone:!!st.tombstone};
      }
      const code = String((response && response.result && response.result.code) || 'NETWORK');
      lastError = {code, retryable:mtBaselineCodeRetryable(code)};
      if(!lastError.retryable) break;
    }
    throw Object.assign(new Error((lastError && lastError.code) || 'NETWORK'), lastError || {});
  }

  // Bounded read-only revision fetch. Жодної локальної зміни: повертає лише
  // baseline і множину cloud-id, які виявились tombstone (видалені на сервері).
  async function mtFetchBaselines(items, opts){
    items = Array.isArray(items) ? items : [];
    const baselines = [];
    const skipCloud = {ticket:new Set(), shift:new Set()};
    if(!items.length) return {baselines, skipCloud};
    const transport = opts && opts.transport;
    if(!transport || typeof transport.getEntityState !== 'function') throw new Error('TRANSPORT_UNAVAILABLE');
    const concurrency = Math.max(1, Number((opts && opts.concurrency)) || 6);
    const onProgress = (opts && typeof opts.onProgress === 'function') ? opts.onProgress : null;
    const errors = [];
    let next = 0, done = 0;
    async function worker(){
      while(true){
        const index = next++;
        if(index >= items.length) return;
        const item = items[index];
        try{
          const baseline = await mtFetchEntityBaseline(transport, item.entity, item.id, opts);
          if(baseline.tombstone) skipCloud[item.entity].add(item.id);
          else baselines.push(baseline);
        }catch(error){
          errors.push({entity:item.entity, id:item.id, code:(error && error.code) || 'FETCH_FAILED'});
        }
        done++;
        if(onProgress) onProgress(done, items.length);
      }
    }
    const workers = [];
    const workerCount = Math.min(concurrency, items.length);
    for(let i = 0; i < workerCount; i++) workers.push(worker());
    await Promise.all(workers);
    if(errors.length) throw Object.assign(new Error('REVISION_FETCH_FAILED'), {code:'REVISION_FETCH_FAILED', errors});
    return {baselines, skipCloud};
  }

  async function mtCreatePreRestoreBackup(){
    if(!backupDb) throw new Error('BACKUP_UNAVAILABLE');
    const tools = typeof toolsExportData === 'function' ? toolsExportData() : {};
    const payload = {
      app:'master-tracker', backupVersion:6, exportedAt:new Date().toISOString(),
      tickets: typeof mtBackupSafeExport === 'function' ? mtBackupSafeExport(tickets || []) : (tickets || []),
      shifts: typeof mtBackupSafeExport === 'function' ? mtBackupSafeExport(shifts || []) : (shifts || []),
      settings: typeof securitySanitizeSettingsForBackup === 'function' ? securitySanitizeSettingsForBackup(settings || {}) : (settings || {}),
      diagnostics: typeof mtBackupSafeExport === 'function' ? mtBackupSafeExport(tools.diagnostics || []) : (tools.diagnostics || []),
      networkPoints: typeof mtBackupSafeExport === 'function' ? mtBackupSafeExport(tools.networkPoints || []) : (tools.networkPoints || []),
      syncJournal: JSON.parse(JSON.stringify((typeof syncEngine !== 'undefined' && syncEngine && syncEngine.state) ? syncEngine.state : {records:{}})),
      secretsExcluded:true
    };
    const key = MT_RESTORE_BACKUP_PREFIX + new Date().toISOString().replace(/[:.]/g, '-');
    if(!(await backupDbPut(key, payload))) throw new Error('BACKUP_WRITE_FAILED');
    const index = loadDailyBackupIndex();
    index.unshift({date:key, ts:Date.now(), ticketsCount:(tickets || []).length, shiftsCount:(shifts || []).length});
    saveDailyBackupIndex(index.slice(0, (typeof DAILY_BACKUP_MAX === 'number' ? DAILY_BACKUP_MAX : 10)));
    return key;
  }

  async function mtApplyRestore(opts){
    const deps = opts.deps || mtRestoreDeps();
    const prevTickets = JSON.parse(JSON.stringify(tickets || []));
    const prevShifts = JSON.parse(JSON.stringify(shifts || []));
    const prevTicketSnapshot = JSON.parse(JSON.stringify(syncTicketsSnapshot || []));
    const prevShiftSnapshot = JSON.parse(JSON.stringify(syncShiftsSnapshot || []));
    const prevJournal = JSON.parse(JSON.stringify((typeof syncEngine !== 'undefined' && syncEngine && syncEngine.state) ? syncEngine.state : {records:{}}));
    const skipCloud = opts.skipCloud || {ticket:new Set(), shift:new Set()};
    const errors = [];
    let ticketCount = null, shiftCount = null;

    try{
      if(opts.ticketPlan){
        const next = MTRestoreFromSheets.applyTicketPlan(tickets || [], opts.cloudTickets || [], opts.decisions.tickets || {}, deps, skipCloud.ticket);
        tickets = next;
        syncTicketsSnapshot = JSON.parse(JSON.stringify(next));
        if(await saveTicketsLocalOnly()) ticketCount = next.length;
        else errors.push('заявки');
      }
      if(opts.shiftPlan){
        const next = MTRestoreFromSheets.applyShiftPlan(shifts || [], opts.cloudShifts || [], opts.decisions.shifts || {}, skipCloud.shift);
        shifts = next;
        syncShiftsSnapshot = JSON.parse(JSON.stringify(next));
        if(await saveShiftsLocalOnly()) shiftCount = next.length;
        else errors.push('зміни');
      }
      if(errors.length) throw new Error('DATA_WRITE_FAILED');

      const baselines = Array.isArray(opts.baselines) ? opts.baselines : [];
      if(baselines.length && typeof syncEngine !== 'undefined' && syncEngine){
        if(typeof syncEngine.seedBaselines === 'function'){
          // Одна журнальна трансакція на весь набір: baseline тепер
          // вирівнюється для всіх записів з хмари, тому окремий запис на кожен
          // id був би квадратичним по I/O на великій базі.
          await syncEngine.seedBaselines(baselines);
        }else if(typeof syncEngine.seedBaseline === 'function'){
          for(const baseline of baselines){
            await syncEngine.seedBaseline(baseline.entity, baseline.id, {revision:baseline.revision, tombstone:!!baseline.tombstone});
          }
        }
      }
    }catch(_error){
      // Відкат має повернути не лише памʼять, а й те, що вже встигло лягти на
      // диск: інакше після перезапуску застосунок показав би частково
      // застосоване відновлення, хоча користувач бачив помилку.
      const rollbackFailed = [];
      if(opts.ticketPlan){
        tickets = prevTickets; syncTicketsSnapshot = prevTicketSnapshot;
        let saved = true;
        try{ saved = typeof saveTicketsLocalOnly !== 'function' || (await saveTicketsLocalOnly()) !== false; }catch(_rollbackError){ saved = false; }
        if(!saved) rollbackFailed.push('заявки');
      }
      if(opts.shiftPlan){
        shifts = prevShifts; syncShiftsSnapshot = prevShiftSnapshot;
        let saved = true;
        try{ saved = typeof saveShiftsLocalOnly !== 'function' || (await saveShiftsLocalOnly()) !== false; }catch(_rollbackError){ saved = false; }
        if(!saved) rollbackFailed.push('зміни');
      }
      if(typeof syncEngine !== 'undefined' && syncEngine && typeof syncEngine.replaceState === 'function'){
        try{ await syncEngine.replaceState(prevJournal); }catch(_journalError){}
      }
      return {ok:false, errors, ticketCount:tickets.length, shiftCount:shifts.length, rollbackFailed};
    }
    return {ok:true, errors:[], ticketCount, shiftCount, rollbackFailed:[]};
  }

  function mtShowRestoreResult(result, backupKey){
    const title = result.ok ? 'Відновлення завершено' : 'Відновлення не вдалося';
    const lines = [];
    if(result.ticketCount !== null) lines.push(`Заявок у локальній базі: ${result.ticketCount}`);
    if(result.shiftCount !== null) lines.push(`Змін у локальній базі: ${result.shiftCount}`);
    if(backupKey) lines.push(`Резервна копія до відновлення: ${backupKey}`);
    if(!result.ok && result.errors && result.errors.length) lines.push(`Помилка застосування: ${result.errors.join(', ')}. Локальний стан повернуто, доступна резервна копія.`);
    if(!result.ok && result.rollbackFailed && result.rollbackFailed.length) lines.push(`Не вдалося повернути на диск: ${result.rollbackFailed.join(', ')}. Відновіть стан із резервної копії нижче.`);
    if(result.ok) lines.push('Дані збережено локально та не відправлено повторно в Google Sheets.');
    openModal(title, `<div class="report-text">${lines.map(escapeHtml).join('<br>')}</div><button type="button" class="btn btn-accent btn-block" style="margin-top:12px;" data-modal-cancel>Гаразд</button>`, {
      onOpen: bodyEl=>{ bodyEl.querySelector('[data-modal-cancel]').onclick = ()=>closeModal(); }
    });
  }

  async function restoreFromGoogleSheets(scope){
    scope = scope === 'tickets' || scope === 'shifts' ? scope : 'both';
    if(typeof navigator !== 'undefined' && navigator.onLine === false){
      showToast('Немає інтернету — відновлення з Google Sheets недоступне');
      return;
    }
    const transport = syncEngine && syncEngine.transport;
    if(!transport || typeof transport.listAll !== 'function'){
      showToast('Синхронізацію не налаштовано — заповніть URL Apps Script і HMAC-ключ');
      return;
    }
    if(!getScriptUrl() || String(settings.syncHmacSecret || '').length < 32){
      showToast('Спочатку налаштуйте URL Apps Script і HMAC-ключ (мінімум 32 символи)');
      return;
    }

    showToast('Отримую дані з Google Sheets…');
    let response;
    try{
      response = await transport.listAll();
    }catch(error){
      globalThis.MTSafeError && globalThis.MTSafeError.reportError && globalThis.MTSafeError.reportError(error, {scope:'sheets-restore-fetch'});
      showToast('Не вдалося отримати дані: мережева помилка. Локальну базу не змінено.');
      return;
    }

    const validation = MTRestoreFromSheets.validateCloudListPayload(response && response.result);
    if(!validation.ok){
      mtRestoreCloudError(validation.code);
      return;
    }

    const deps = mtRestoreDeps();
    const includeTickets = scope !== 'shifts';
    const includeShifts = scope !== 'tickets';
    const ticketPlan = includeTickets ? MTRestoreFromSheets.buildTicketPlan(tickets || [], validation.tickets, deps) : null;
    const shiftPlan = includeShifts ? MTRestoreFromSheets.buildShiftPlan(shifts || [], validation.shifts) : null;

    // R2: локальні записи, яких немає в хмарі, але серверний state — tombstone.
    // Рахуємо це до показу аналізу: користувач має бачити, що такі записи
    // лишаються локально і не синхронізуються самі.
    const localOnlyItems = [];
    if(ticketPlan) ticketPlan.items.forEach(item=>{ if(item.kind === 'local-only') localOnlyItems.push({entity:'ticket', id:item.id}); });
    if(shiftPlan) shiftPlan.items.forEach(item=>{ if(item.kind === 'local-only') localOnlyItems.push({entity:'shift', id:item.id}); });
    const deletedLocalBaselines = (validation.states && localOnlyItems.length)
      ? MTRestoreFromSheets.tombstonedLocalBaselines(localOnlyItems, validation.states).baselines
      : [];
    if(deletedLocalBaselines.length){
      if(ticketPlan) ticketPlan.stats.cloudDeletedLocalCount = deletedLocalBaselines.filter(item=>item.entity === 'ticket').length;
      if(shiftPlan) shiftPlan.stats.cloudDeletedLocalCount = deletedLocalBaselines.filter(item=>item.entity === 'shift').length;
    }

    const proceed = await mtShowRestoreAnalysis(scope, ticketPlan, shiftPlan);
    if(!proceed) return;

    const decision = await mtCollectRestoreDecisions(ticketPlan, shiftPlan);
    if(!decision || decision.cancelled) return;

    if(typeof syncEngine !== 'undefined' && syncEngine && typeof syncEngine.pendingCount === 'function' && syncEngine.pendingCount() > 0){
      showToast('Є несинхронізовані локальні зміни — спершу синхронізуйте їх, потім повторіть відновлення');
      return;
    }

    const summary = mtBuildRestoreSummary(scope, ticketPlan, shiftPlan, decision);
    if(!await openConfirmModal({title:'Застосувати відновлення з Google Sheets?', message:summary, confirmLabel:'Відновити', danger:true})) return;

    // Read-only baseline: отримуємо серверну revision для всіх записів, що є в
    // хмарі (нові, однакові, конфлікти — рішення впливає лише на контент).
    // Жодна локальна зміна не відбувається, поки всі версії не отримані.
    const baselineItems = [
      ...(ticketPlan ? MTRestoreFromSheets.baselineRequests(ticketPlan) : []),
      ...(shiftPlan ? MTRestoreFromSheets.baselineRequests(shiftPlan) : [])
    ];
    let baselineResult;
    if(baselineItems.length){
      if(validation.states){
        // Новий сервер: ревізії вже прийшли разом з list — жодного
        // додаткового запиту на запис.
        try{
          baselineResult = MTRestoreFromSheets.baselineFromStates(baselineItems, validation.states);
        }catch(error){
          globalThis.MTSafeError && globalThis.MTSafeError.reportError && globalThis.MTSafeError.reportError(error, {scope:'sheets-restore-revision'});
          showToast('Не вдалося отримати серверні версії записів — локальну базу не змінено');
          return;
        }
      }else{
        // Старий сервер без states: попередня поведінка, getEntityState на запис.
        let progressEl = null;
        openModal('Перевірка стану синхронізації', `<div style="font-size:14px; color:var(--text-dim);">Отримую серверні версії записів…</div><div id="mtBaselineProgress" style="font-weight:700; margin-top:6px;">0 / ${baselineItems.length}</div>`, {
          onOpen: body=>{ progressEl = body.querySelector('#mtBaselineProgress'); }
        });
        try{
          baselineResult = await mtFetchBaselines(baselineItems, {
            transport,
            concurrency:6,
            maxRetries:2,
            onProgress:(done,total)=>{ if(progressEl) progressEl.textContent = `${done} / ${total}`; }
          });
        }catch(error){
          globalThis.MTSafeError && globalThis.MTSafeError.reportError && globalThis.MTSafeError.reportError(error, {scope:'sheets-restore-revision'});
          closeModal();
          showToast('Не вдалося отримати серверні версії записів — локальну базу не змінено');
          return;
        }
        closeModal();
      }
    }else{
      baselineResult = {baselines:[], skipCloud:{ticket:new Set(), shift:new Set()}};
    }
    // R2: baseline локально лишених, але вже видалених у хмарі записів
    // (пораховано вище) додаємо до того самого набору seed — навіть коли в
    // хмарі немає жодного запису для відновлення.
    if(validation.states && deletedLocalBaselines.length) baselineResult.baselines = baselineResult.baselines.concat(deletedLocalBaselines);

    let backupKey = '';
    try{
      backupKey = await mtCreatePreRestoreBackup();
    }catch(error){
      globalThis.MTSafeError && globalThis.MTSafeError.reportError && globalThis.MTSafeError.reportError(error, {scope:'sheets-restore-backup'});
      showToast('Не вдалося створити резервну копію перед відновленням — відновлення скасовано');
      return;
    }

    const applied = await mtApplyRestore({
      ticketPlan, shiftPlan,
      cloudTickets: validation.tickets, cloudShifts: validation.shifts,
      decisions: decision, deps,
      baselines: baselineResult.baselines,
      skipCloud: baselineResult.skipCloud
    });

    if(typeof renderTicketsScreen === 'function') renderTicketsScreen();
    if(typeof renderShiftsScreen === 'function') renderShiftsScreen();
    if(typeof renderSettingsScreen === 'function') renderSettingsScreen();
    if(typeof renderDailyBackupList === 'function') renderDailyBackupList();
    mtShowRestoreResult(applied, backupKey);
  }

  globalThis.restoreFromGoogleSheets = restoreFromGoogleSheets;
  globalThis.MTSheetsRestoreRuntime = {
    mtRestoreDeps,
    mtFetchEntityBaseline,
    mtFetchBaselines,
    mtCreatePreRestoreBackup,
    mtApplyRestore,
    mtBuildRestoreSummary
  };
}
