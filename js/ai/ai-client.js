/* AI: клієнт нашого backend (єдині точки — POST /ask і GET /healthz).
   Нічого не знає про Groq/DeepSeek: upstream схований на Worker'і.
   Чистий модуль без DOM — покривається unit-тестами (mock fetch). */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
const validateTicketId = MTAI.ticketIds ? MTAI.ticketIds.validate : function(value){ const id=String(value==null?'':value).trim(); return /^[A-Za-z0-9._:-]{1,128}$/.test(id)?id:null; };
MTAI.createClient = function(options){
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const getConfig = options.getConfig; // () => ({backendUrl, bearer, model, provider})
  const timeoutMs = (options.timeoutMs || MTAI.config.LIMITS.timeoutMs);
  /* Leaves headroom below /ask's 32768-character limit. Overridable so tests can
     exercise the boundary and the honest context_too_large error. */
  const maxRequestChars = Number(options.maxRequestChars) > 0 ? Math.floor(Number(options.maxRequestChars)) : 30000;

  /* Запасний парсер часу з ТЕКСТУ помилки (основне джерело — число від
     Worker'а). Розуміє і словесні форми, і Groq-формат тривалості
     («try again in 7.66s», «1m30s»), тому точний час показується навіть до
     оновлення Worker'а. Повертає цілі секунди або null. */
  function parseDurationSec(raw){
    const t = String(raw || '').trim().toLowerCase();
    if(!t) return null;
    if(/^\d+(?:\.\d+)?$/.test(t)){
      const plain = Number(t);
      return isFinite(plain) && plain > 0 ? Math.ceil(plain) : null;
    }
    const units = { ms:0.001, s:1, m:60, h:3600 };
    let total = 0, matched = false;
    const re = /(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g;
    let part;
    while((part = re.exec(t)) !== null){
      const amount = Number(part[1]);
      if(!isFinite(amount)) continue;
      total += amount * units[part[2]];
      matched = true;
    }
    if(!matched || total <= 0) return null;
    return Math.max(1, Math.ceil(total));
  }

  function parseRetryAfter(text){
    const t = String(text || '');
    let m = /(\d{1,4})\s*(?:секунд|секунди|сек|seconds?|sec\b)/i.exec(t);
    if(m) return Number(m[1]);
    m = /try again in\s+((?:\d+(?:\.\d+)?\s*(?:ms|h|m|s))+)/i.exec(t);
    if(m) return parseDurationSec(m[1]);
    m = /retry[-\s]?after\D{0,12}(\d{1,4})/i.exec(t);
    return m ? Number(m[1]) : null;
  }

  function normalizeError(status, payload, networkErr){
    if(networkErr){
      const aborted = networkErr && networkErr.name === 'AbortError';
      return { kind: aborted ? 'timeout' : 'network',
        message: aborted ? 'Бекенд не відповів вчасно. Холодний запит може тривати до ~20 с.' : 'Немає з’єднання з AI-бекендом.',
        detail: '' };
    }
    const code = payload && payload.code ? String(payload.code) : '';
    const detail = payload && typeof payload.detail === 'string' ? payload.detail : '';
    if(status === 401) return { kind:'auth', message:'Невірний токен AI-бекенда. Перевірте його в Налаштуваннях → 🤖 AI.', detail:'' };
    if(status === 402 || code === 'HTTP_402' || code === 'insufficient_balance' || /insufficient balance/i.test(detail)){
      return { kind:'billing', message:'Недостатній баланс на акаунті AI-провайдера (DeepSeek Insufficient Balance). Поповніть рахунок на платформі провайдера.', detail: detail };
    }
    /* v91.60: Groq відмовляє на ХВИЛИННИЙ бюджет токенів (TPM) кодом HTTP 413
       «Request too large … on tokens per minute (TPM): Limit N, Requested M».
       Це не «завеликий запит» і не помилка сервера: провайдер рахує
       prompt + зарезервовану відповідь проти ліміту за хвилину. Новий Worker
       віддає 429 token_budget; старий — 502 HTTP_413 з тим самим текстом у
       detail. Обидва формати показуються чесно, з числами провайдера. */
    const tokenBudgetText = /tokens per minute|\bTPM\b/i.test(detail);
    if(code === 'token_budget' || (code === 'HTTP_413' && tokenBudgetText)){
      const budget = payload && payload.tokenBudget && typeof payload.tokenBudget === 'object' ? payload.tokenBudget : {};
      let limit = Number(budget.limit), requested = Number(budget.requested);
      if(!(limit > 0)){ const m = /Limit\s+(\d+)/i.exec(detail); limit = m ? Number(m[1]) : 0; }
      if(!(requested > 0)){ const m = /Requested\s+(\d+)/i.exec(detail); requested = m ? Number(m[1]) : 0; }
      const fromPayload = payload && (payload.retryAfterSeconds != null ? payload.retryAfterSeconds : payload.retry_after_sec);
      const numeric = Number(fromPayload);
      const retryAfterSec = (isFinite(numeric) && numeric > 0) ? Math.ceil(numeric) : (parseRetryAfter(detail) || null);
      const numbers = (limit > 0 && requested > 0) ? ' (запит ' + requested + ' токенів при ліміті ' + limit + ' за хвилину)' : '';
      return { kind:'rate_limit',
        message: 'Хвилинний ліміт токенів провайдера' + numbers + '. '
          + (retryAfterSec ? 'Повторіть через ~' + retryAfterSec + ' с' : 'Зачекайте хвилину або скоротіть запит чи очистіть чат') + '.',
        detail: detail, retryAfterSec: retryAfterSec, tokenBudget: {limit: limit || null, requested: requested || null} };
    }
    /* Поточний production-Worker віддає upstream-429 як 502 HTTP_429 (нова
       версія віддає чесний 429). Розпізнаємо обидва формати, щоб фікс працював
       і до оновлення Worker'а. */
    const upstreamRateLimit = code === 'HTTP_429' || code === 'rate_limit'
      || (payload && payload.error === 'rate_limited');
    if(status === 429 || upstreamRateLimit || /rate limit/i.test(detail)){
      /* Джерело істини — нормалізоване число від Worker'а (він бере його з
         Groq/DeepSeek retry-after / x-ratelimit-reset-*). Текст розбираємо лише як
         запасний варіант. Якщо точного часу НЕМАЄ — не вигадуємо countdown:
         краще чесне «спробуйте пізніше», ніж хибне «через 20–30 с». */
      const fromPayload = payload && (payload.retryAfterSeconds != null ? payload.retryAfterSeconds : payload.retry_after_sec);
      const numeric = Number(fromPayload);
      const retryAfterSec = (isFinite(numeric) && numeric > 0)
        ? Math.ceil(numeric)
        : (parseRetryAfter(detail) || null);
      return { kind:'rate_limit',
        message: retryAfterSec
          ? 'Ліміт запитів AI-провайдера. Просить зачекати ~' + retryAfterSec + ' с.'
          : 'Ліміт запитів AI-провайдера ще не відновився. Спробуйте пізніше.',
        detail: detail, retryAfterSec: retryAfterSec };
    }
    if(status === 503) return { kind:'not_configured',
      message:'AI на цьому backend не налаштований або провайдера вимкнено (' + ((payload && (payload.error || code)) || 'ask_not_configured') + '). Перевірте, що провайдер увімкнено на Worker і ключ додано як Secret (див. «Як підключити AI» у налаштуваннях).',
      detail: detail };
    if(status === 400) return { kind:'bad_request', message:'Некоректний запит (' + code + ').', detail: detail };
    if(status >= 500) return { kind:'server', message:'Помилка сервера (' + status + (code ? ' ' + code : '') + ').', detail: detail };
    return { kind:'http', message:'Помилка ' + status + (code ? ' ' + code : '') + '.', detail: detail };
  }

  /* Структуровані заявки від /ask (кнопки «Відкрити заявку»). Лише сувора
     проєкція: рядкові поля, обрізані за довжиною; id — безпечний формат.
     Клієнт НІКОГДА не приймає від моделі URL — навігація тільки за id. */
  function normalizeTickets(raw){
    if(!Array.isArray(raw)) return [];
    const out = [];
    for(const item of raw){
      if(!item || typeof item !== 'object') continue;
      const id = validateTicketId(item.id);
      if(!id) continue;
      const sum = (typeof item.sum === 'number' && isFinite(item.sum)) ? String(Math.round(item.sum * 100) / 100) : String(item.sum == null ? '' : item.sum).trim().slice(0, 16);
      out.push({
        id: id,
        date: String(item.date == null ? '' : item.date).trim().slice(0, 32),
        time: String(item.time == null ? '' : item.time).trim().slice(0, 16),
        address: String(item.address == null ? '' : item.address).trim().slice(0, 200),
        type: String(item.type == null ? '' : item.type).trim().slice(0, 100),
        sum: sum,
        signal: String(item.signal == null ? '' : item.signal).trim().slice(0, 32),
        note: String(item.note == null ? '' : item.note).trim().slice(0, 120)
      });
      if(out.length >= 8) break;
    }
    return out;
  }

  /* MINIMAL whitelist для прихованого referent-контексту наступного turn:
     ЛИШЕ id/date/time/address/type/sum/signal — поля, потрібні для
     розв'язання посилання та відкриття заявки. Навіть якщо старий persisted
     history містить note/phone/geo — у body.context вони НЕ їдуть. */
  function normalizeReferentTickets(raw){
    if(!Array.isArray(raw)) return [];
    const out = [];
    for(const item of raw){
      if(!item || typeof item !== 'object') continue;
      const id = validateTicketId(item.id);
      if(!id) continue;
      out.push({
        id: id,
        date: String(item.date == null ? '' : item.date).trim().slice(0, 32),
        time: String(item.time == null ? '' : item.time).trim().slice(0, 16),
        address: String(item.address == null ? '' : item.address).trim().slice(0, 200),
        type: String(item.type == null ? '' : item.type).trim().slice(0, 100),
        sum: (typeof item.sum === 'number' && isFinite(item.sum)) ? String(Math.round(item.sum * 100) / 100) : String(item.sum == null ? '' : item.sum).trim().slice(0, 16),
        signal: String(item.signal == null ? '' : item.signal).trim().slice(0, 32)
      });
      if(out.length >= 8) break;
    }
    return out;
  }

  /* История текущей AI-сессии (bounded: последние 12 user/assistant). */
  function sanitizeHistory(raw){
    if(!Array.isArray(raw)) return [];
    const out = [];
    for(const item of raw.slice(-50)){
      if(!item || typeof item !== 'object') continue;
      const role = item.role === 'assistant' ? 'assistant' : (item.role === 'user' ? 'user' : null);
      if(!role) continue;
      const text = String(item.text == null ? '' : item.text).trim().slice(0, 1500);
      if(!text) continue;
      out.push({ role: role, content: text });
    }
    return out.slice(-12);
  }

  /* v91.46: структурований follow-up контекст (авторитетні структуровані
     фільтри попереднього query_tickets) — строга біла проєкція, дзеркало
     серверного mcp/src/ask/query-context.js. Ніяких нотаток/телефонів/ПІБ:
     невідомі ключі відкидаються. */
  const QC_INHERITABLE = ['date_from','date_to','city','street','city_id','street_id','house','apartment','type','tags','payment','sum_min','sum_max','signal_worse_than','signal_worse_or_equal','signal_better_than','has_signal','coworker','items'];
  /* Stage 2D: directory identity of a resolved place (UUID shape only) — the
     follow-up re-runs by UUID, mirror of the server whitelist. */
  const QC_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function sanitizeQueryContext(raw){
    if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const rf = raw.resolved_filters;
    if(!rf || typeof rf !== 'object' || Array.isArray(rf)) return null;
    const out = {};
    for(const key of QC_INHERITABLE){
      const v = rf[key];
      if(v === undefined || v === null || v === '') continue;
      if(key === 'date_from' || key === 'date_to'){
        if(/^\d{2}\.\d{2}\.\d{4}$/.test(String(v))) out[key] = String(v);
      }else if(key === 'sum_min' || key === 'sum_max' || key === 'signal_worse_than' || key === 'signal_worse_or_equal' || key === 'signal_better_than'){
        const n = Number(v);
        if(isFinite(n)) out[key] = n;
      }else if(key === 'has_signal'){
        if(typeof v === 'boolean') out[key] = v;
      }else if(key === 'city_id' || key === 'street_id'){
        if(typeof v === 'string' && QC_ID_RE.test(v)) out[key] = v.toLowerCase();
      }else if(key === 'tags'){
        if(Array.isArray(v)) out[key] = v.slice(0,20).map(function(t){ return String(t == null ? '' : t).slice(0,60); }).filter(Boolean);
      }else if(key === 'items'){
        if(Array.isArray(v)){
          const items = v.slice(0,8).map(function(item){
            if(!item || typeof item !== 'object' || Array.isArray(item)) return null;
            const text = String(item.text == null ? '' : item.text).slice(0,80).trim();
            if(!text) return null;
            const clean = {text:text};
            /* kind — обмеження пулу позицій; лише з дозволеного enum. */
            if(['equipment','cable','preset_work','additional_work'].indexOf(item.kind) !== -1) clean.kind = item.kind;
            for(const nk of ['unit_price','quantity','total']){
              const n = Number(item[nk]);
              if(isFinite(n) && item[nk] !== null && item[nk] !== undefined && item[nk] !== '') clean[nk] = n;
            }
            return clean;
          }).filter(Boolean);
          if(items.length) out[key] = items;
        }
      }else{
        out[key] = String(v).slice(0, key === 'coworker' ? 60 : 100);
      }
    }
    if(!Object.keys(out).length) return null;
    return {resolved_filters:out};
  }

  /* Структурований контекст попередньої відповіді (референт для «відкрий
     цю заявку»): лише та сама безпечна проєкція заявок. */
  function sanitizeLocalQuery(raw){
    if(!raw || typeof raw !== 'object' || raw.kind !== 'network_points') return null;
    const dateOk = function(v){ return /^\d{2}\.\d{2}\.\d{4}$/.test(String(v || '')) ? String(v) : null; };
    return {
      kind: 'network_points',
      type: typeof raw.type === 'string' ? raw.type.slice(0, 20) : null,
      text: String(raw.text == null ? '' : raw.text).slice(0, 300),
      date_from: dateOk(raw.date_from),
      date_to: dateOk(raw.date_to),
      period_note: typeof raw.period_note === 'string' ? raw.period_note.slice(0, 120) : null
    };
  }

  function sanitizeResultSet(raw){
    if(!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const chatSessionId = String(raw.chatSessionId == null ? '' : raw.chatSessionId).trim();
    if(!/^[A-Za-z0-9._:-]{8,128}$/.test(chatSessionId) || Number(raw.version) !== 1) return null;
    if(!Array.isArray(raw.ticketIds) || !raw.ticketIds.length || raw.ticketIds.length > 100) return null;
    const ticketIds = [];
    for(const value of raw.ticketIds){
      const id = validateTicketId(value);
      if(!id) return null;
      ticketIds.push(id);
    }
    const createdAt = Number(raw.createdAt), expiresAt = Number(raw.expiresAt);
    if(!isFinite(createdAt) || !isFinite(expiresAt) || expiresAt <= createdAt) return null;
    /* An expired set is dropped HERE (and therefore also after a reload): a stale
       list must never keep the ordinal selector alive or block the ordinary
       referent path («пошук → відкрий її»). */
    if(expiresAt <= Date.now()) return null;
    return {version:1,id:String(raw.id == null ? '' : raw.id).slice(0,128),chatSessionId:chatSessionId,createdAt:createdAt,expiresAt:expiresAt,total:Math.max(0,Number(raw.total)||0),filtersKey:(typeof raw.filtersKey === 'string' && raw.filtersKey) ? raw.filtersKey.slice(0,300) : null,ticketIds:ticketIds};
  }

  function sanitizeResultItems(raw){
    if(!Array.isArray(raw)) return [];
    return raw.slice(0,100).map(function(item, idx){
      if(!item || typeof item !== 'object') return null;
      const id = validateTicketId(item.ticket_id);
      if(!id) return null;
      return {index:idx+1,ticket_id:id,date:String(item.date||'').slice(0,32),time:String(item.time||'').slice(0,16),address:String(item.address||'').slice(0,200),type:String(item.type||'').slice(0,100),sum:String(item.sum||'').slice(0,16),signal:String(item.signal||'').slice(0,32)};
    }).filter(Boolean);
  }

  function sanitizePresentation(raw){
    if(!raw || raw.kind !== 'single_ticket') return null;
    const id = validateTicketId(raw.ticket_id);
    return id ? {kind:'single_ticket',ticket_id:id} : null;
  }

  async function ask(question, history, context){
    const cfg = getConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(function(){ ctrl.abort(); }, timeoutMs);
    const body = {
      question: String(question).slice(0, MTAI.config.LIMITS.questionMaxChars),
      history: sanitizeHistory(history),
      provider: cfg.provider || MTAI.config.DEFAULT_PROVIDER,
      model: cfg.model || MTAI.config.DEFAULT_MODEL
    };
    /* Контекст додається ЛИШЕ коли він є — перше питання сесії лишає
       тіло запиту байт-в-байт таким самим, як раніше. */
    const ctxTickets = context && Array.isArray(context.tickets) ? normalizeReferentTickets(context.tickets) : [];
    if(ctxTickets.length) body.context = { tickets: ctxTickets };
    /* v91.46: follow-up контекст додається ЛИШЕ коли він є. */
    const ctxQuery = sanitizeQueryContext(context && context.queryContext);
    if(ctxQuery){
      body.context = body.context || {};
      body.context.queryContext = ctxQuery;
    }
    const session = String(context && context.chatSessionId || '').trim();
    if(/^[A-Za-z0-9._:-]{8,128}$/.test(session)){
      body.context = body.context || {};
      body.context.chatSessionId = session;
    }
    const ctxResultSet = sanitizeResultSet(context && context.resultSet);
    if(ctxResultSet){
      body.context = body.context || {};
      body.context.resultSet = ctxResultSet;
    }
    const ctxSelected = validateTicketId(context && context.selectedTicketId);
    if(ctxSelected){
      body.context = body.context || {};
      body.context.selectedTicketId = ctxSelected;
    }
    while(body.history.length && JSON.stringify(body).length > maxRequestChars) body.history.shift();
    if(JSON.stringify(body).length > maxRequestChars){
      clearTimeout(timer);
      return {ok:false,error:{kind:'context_too_large',message:'Контекст чата слишком велик. Очистите чат и повторите запрос.',detail:''}};
    }
    try{
      const res = await fetchImpl(cfg.backendUrl + '/ask', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + cfg.bearer },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      const payload = await res.json().catch(function(){ return null; });
      if(res.ok && payload && payload.ok){
        return { ok:true, answer:String(payload.answer || ''), meta: payload.meta || {}, total: Number.isFinite(Number(payload.total)) ? Number(payload.total) : (payload.meta && Number.isFinite(Number(payload.meta.total)) ? Number(payload.meta.total) : null), shown:Number.isFinite(Number(payload.shown))?Number(payload.shown):0, tickets: normalizeTickets(payload.tickets), referentTickets: normalizeReferentTickets(payload.referentTickets), queryContext: sanitizeQueryContext(payload.queryContext), localQuery: sanitizeLocalQuery(payload.localQuery), resultSet:sanitizeResultSet(payload.resultSet), resultItems:sanitizeResultItems(payload.resultItems), selectedTicketId:validateTicketId(payload.selectedTicketId), presentation:sanitizePresentation(payload.presentation), resultSetStatus:(payload.resultSetStatus&&typeof payload.resultSetStatus==='object')?payload.resultSetStatus:null };
      }
      return { ok:false, error: normalizeError(res.status, payload, null) };
    }catch(err){
      return { ok:false, error: normalizeError(0, null, err) };
    }finally{
      clearTimeout(timer);
    }
  }

  async function health(){
    const cfg = getConfig();
    try{
      const res = await fetchImpl(cfg.backendUrl + '/healthz', { method:'GET' });
      const payload = await res.json().catch(function(){ return null; });
      return { online: !!(res.ok && payload && payload.ok), service: payload && payload.service || '', readOnly: !!(payload && payload.read_only), status: res.status };
    }catch(_err){
      return { online:false, service:'', readOnly:false, status:0 };
    }
  }

  /* Публічний дескриптор можливостей бекенда (без секретів у відповіді).
     Authorization додаємо: «свій backend» може вимагати токен навіть тут. */
  async function config(){
    const cfg = getConfig();
    try{
      const res = await fetchImpl(cfg.backendUrl + '/ai/config', {
        method:'GET',
        headers: cfg.bearer ? { 'Authorization':'Bearer ' + cfg.bearer } : {}
      });
      const payload = await res.json().catch(function(){ return null; });
      if(!res.ok || !payload || !payload.ok) return { ok:false, status:res.status };
      return { ok:true, status:res.status, config: payload };
    }catch(_err){
      return { ok:false, status:0 };
    }
  }

  return { ask: ask, health: health, config: config, normalizeTickets: normalizeTickets, normalizeReferentTickets: normalizeReferentTickets, sanitizeHistory: sanitizeHistory, sanitizeLocalQuery: sanitizeLocalQuery, sanitizeResultSet:sanitizeResultSet, sanitizeResultItems:sanitizeResultItems };
};

/* Инстанс приложения: конфиг читается лениво (backendUrl/токен могут
   меняться в настройках на лету). */
MTAI.client = MTAI.createClient({
  getConfig: function(){
    return {
      backendUrl: MTAI.storage.get().backendUrl,
      bearer: MTAI.storage.bearer(),
      provider: MTAI.storage.get().provider,
      model: MTAI.storage.get().model
    };
  }
});
})();
