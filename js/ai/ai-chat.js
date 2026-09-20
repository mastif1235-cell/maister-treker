/* AI: логіка чату (стан сесії, надсилання, повтор, помилки). Чиста —
   DOM вводиться через колбеки, тому покривається unit-тестами. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
const validateTicketId = MTAI.ticketIds ? MTAI.ticketIds.validate : function(value){ const id=String(value==null?'':value).trim(); return /^[A-Za-z0-9._:-]{1,128}$/.test(id)?id:null; };
MTAI.createChatController = function(deps){
  const client = deps.client;
  const hooks = deps.hooks || {};
  const attachments = deps.attachments || null;
  const sleep = deps.sleep || function(ms){ return new Promise(function(res){ setTimeout(res, ms); }); };
  const capabilities = deps.capabilities || function(){ return { vision:false }; };
  const historyStorage = deps.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const HISTORY_KEY = 'mtAiChatHistoryV1';
  function safeHistoryText(value){
    return String(value == null ? '' : value).replace(/(?:Bearer\s+|sk-|api[_-]?key\s*[:=]\s*)[A-Za-z0-9._-]{12,}/gi, '[redacted]').slice(0, 1500);
  }
  function loadPersisted(){
    if(!historyStorage) return {messages:[],chatSessionId:newSessionId(),activeResultSet:null,selectedTicketId:null};
    try{
      const raw = JSON.parse(historyStorage.getItem(HISTORY_KEY) || '[]');
      const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.messages) ? raw.messages : []);
      const messages = list.slice(-40).filter(function(m){ return m && (m.role === 'user' || m.role === 'assistant') && safeHistoryText(m.text); }).map(function(m){
        return {role:m.role, text:safeHistoryText(m.text), ts:Number(m.ts)||Date.now(), tickets:safeTickets(m.tickets), referentTickets:safeReferent(m.referentTickets), queryContext:(m.queryContext && typeof m.queryContext === 'object' && !Array.isArray(m.queryContext)) ? m.queryContext : null};
      });
      const sid = raw && !Array.isArray(raw) && /^[A-Za-z0-9._:-]{8,128}$/.test(String(raw.chatSessionId||'')) ? String(raw.chatSessionId) : newSessionId();
      const resultSet = raw && !Array.isArray(raw) && client.sanitizeResultSet ? client.sanitizeResultSet(raw.activeResultSet) : null;
      const selected = validateTicketId(raw && !Array.isArray(raw) ? raw.selectedTicketId : null);
      return {messages:messages,chatSessionId:sid,activeResultSet:resultSet,selectedTicketId:selected};
    }catch(_e){ return {messages:[],chatSessionId:newSessionId(),activeResultSet:null,selectedTicketId:null}; }
  }
  function newSessionId(){
    try{ if(globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID(); }catch(_e){}
    return 'chat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,14);
  }
  const loaded = loadPersisted();
  let messages = loaded.messages;
  let chatSessionId = loaded.chatSessionId;
  let activeResultSet = loaded.activeResultSet;
  let selectedTicketId = loaded.selectedTicketId;
  function safeTickets(raw){
    if(!Array.isArray(raw)) return [];
    return raw.slice(0,8).map(function(t){
      if(!t || typeof t !== 'object') return null;
      const id=validateTicketId(t.id);
      if(!id) return null;
      return {id:id,date:String(t.date||'').slice(0,32),time:String(t.time||'').slice(0,16),address:String(t.address||'').slice(0,200),type:String(t.type||'').slice(0,100),sum:String(t.sum||'').slice(0,16),signal:String(t.signal||'').slice(0,32),note:String(t.note||'').slice(0,120)};
    }).filter(Boolean);
  }
  /* Прихований referent: МИНІМАЛЬНИЙ безпечний набір БЕЗ note/phone/geo —
     лише для розв'язання посилання наступного turn і відкриття заявки. */
  function safeReferent(raw){
    if(!Array.isArray(raw)) return [];
    return raw.slice(0,8).map(function(t){
      if(!t || typeof t !== 'object') return null;
      const id=validateTicketId(t.id);
      if(!id) return null;
      return {id:id,date:String(t.date||'').slice(0,32),time:String(t.time||'').slice(0,16),address:String(t.address||'').slice(0,200),type:String(t.type||'').slice(0,100),sum:String(t.sum||'').slice(0,16),signal:String(t.signal||'').slice(0,32)};
    }).filter(Boolean);
  }
  function persist(){
    if(!historyStorage) return true;
    try{
      historyStorage.setItem(HISTORY_KEY, JSON.stringify({messages:messages.filter(function(m){ return m.role === 'user' || m.role === 'assistant'; }).slice(-40),chatSessionId:chatSessionId,activeResultSet:activeResultSet,selectedTicketId:selectedTicketId}));
      return true;
    }catch(_e){ return false; }
  }
  let busy = false;
  let lastFailed = null;   // останнє питання, яке впало (для «Повторити»)
  let cooldownUntil = 0;   // 429/TPM: until-таймстемп, доки Send/Retry заблоковані
  /* Тривалість cooldown (сек) = РЕАЛЬНИЙ час від upstream (Worker нормалізує
     Groq retry-after / x-ratelimit-reset-*). Жодного clamp у 20–30 с: якщо
     Groq каже 73 с — відлік 73 с, якщо 120 — 120. Якщо точного часу немає,
     повертаємо 0: countdown не показуємо взагалі (краще чесно «спробуйте
     пізніше», ніж хибна обіцянка). У тестах можна перевизначити. */
  const cooldownSec = typeof deps.cooldownSec === 'function'
    ? deps.cooldownSec
    : function(err){
        const sec = Number(err && err.retryAfterSec);
        return (isFinite(sec) && sec > 0) ? Math.ceil(sec) : 0;
      };
  function cooldownRemainingSec(){
    const r = Math.ceil((cooldownUntil - Date.now()) / 1000);
    return r > 0 ? r : 0;
  }

  function emit(name, payload){ if(typeof hooks[name] === 'function') hooks[name](payload); }

  async function send(text, opts){
    const question = String(text == null ? '' : text).trim().slice(0, MTAI.config.LIMITS.questionMaxChars);
    if(!question || busy) return { ok:false, skipped:true };
    const cd = cooldownRemainingSec();
    if(cd > 0){ emit('cooldown_block', { sec: cd }); return { ok:false, skipped:'cooldown', remainingSec: cd }; }
    const isRetry = !!(opts && opts.isRetry);
    if(attachments && attachments.count() && !capabilities().vision){
      const err = { kind:'attachments_unsupported',
        message:'Бекенд поки не приймає зображення (контракт у розробці, див. mcp/docs/ai-multimodal-contract.md). Надішліть питання текстом або приберіть вкладення.' };
      emit('error', err);
      return { ok:false, error: err };
    }
    busy = true; lastFailed = null;
    emit('busy', true);
    /* Retry НЕ створює дублікат повідомлення користувача: воно вже в
       історії з першої спроби (і в message-list, і в bubble). */
    if(!isRetry) emit('user', question);
    /* Bounded контекст сесії: останні 8 user/assistant повідомлень БЕЗ
       поточного питання (воно йде окремим полем) — follow-up «а за август?»,
       «а який там сигнал?» працюють без повторів з боку користувача. */
    const history = messages
      .filter(function(m){ return (m.role === 'user' || m.role === 'assistant'); })
      .slice(-8)
      .map(function(m){ return { role: m.role, text: m.text }; });
    /* Референтний контекст: безпечна проєкція активного результату ОСТАННЬОЇ
       відповіді, щоб «відкрий цю заявку» мало реальний об'єкт дії без
       повторного пошуку. Пріоритет — прихований referentTickets (зберігається
       навіть коли картки при звичайному пошуку НЕ рендерились); fallback —
       видимі tickets зі старих збережених сесій. */
    /* Набір з минулим expiresAt — не стан, на який можна спиратися: він не
       надсилається на сервер і НЕ блокує referent-шлях (інакше протухлий список
       назавжди глушив би «відкрий її» після звичайного пошуку). */
    if(activeResultSet && !(Number(activeResultSet.expiresAt) > Date.now())){
      activeResultSet = null;
      selectedTicketId = null;
      persist();
    }
    let referent = [];
    if(!activeResultSet && !selectedTicketId){
      for(let i = messages.length - 1; i >= 0; i--){
        const m = messages[i];
        if(m.role !== 'assistant') continue;
        const ref = (Array.isArray(m.referentTickets) && m.referentTickets.length) ? m.referentTickets
          : (Array.isArray(m.tickets) && m.tickets.length ? m.tickets : []);
        if(ref.length){ referent = ref; break; }
      }
    }
    /* v91.46: структурований follow-up контекст — ТІЛЬКИ з безпосередньо
       попередньої assistant-відповіді (активний контекст розмови). Жодного
       сканування вглиб: якщо попередня відповідь його не має — контекст
       протух і надсилати старі фільтри не можна. */
    let followUpQueryContext = null;
    for(let i = messages.length - 1; i >= 0; i--){
      const m = messages[i];
      if(m.role !== 'assistant') continue;
      if(m.queryContext && typeof m.queryContext === 'object' && !Array.isArray(m.queryContext)) followUpQueryContext = m.queryContext;
      break;
    }
    if(!isRetry){
      messages.push({ role:'user', text:safeHistoryText(question), ts:Date.now() });
      if(!persist()){
        activeResultSet = null;
        selectedTicketId = null;
        emit('state_degraded');
      }
    }
    /* v91.46: структурований follow-up контекст (авторитетні фільтри
       попереднього query_tickets) — «покажи їх» успадковує ТІ САМІ фільтри
       на свіжому READ; повторно валідується клієнтом і сервером. */
    let outcome = await client.ask(question, history, { tickets: referent, queryContext: followUpQueryContext, chatSessionId:chatSessionId, resultSet:activeResultSet, selectedTicketId:selectedTicketId });
    busy = false;
    emit('busy', false);
    if(outcome.ok){
      /* Успіх (у т.ч. успішний ручний retry): і lastFailed, і cooldown
         скидаються — інакше прострочений cooldownUntil міг би блокувати
         наступний send(), а stale lastFailed тримав би живою кнопку Retry. */
      lastFailed = null; cooldownUntil = 0;
      const resultStatus = outcome.resultSetStatus && typeof outcome.resultSetStatus === 'object' ? outcome.resultSetStatus : null;
      if(outcome.resultSet){
        activeResultSet = outcome.resultSet;
        selectedTicketId = null;
      }else{
        if(outcome.selectedTicketId){
          selectedTicketId = validateTicketId(outcome.selectedTicketId);
        }else if(resultStatus && resultStatus.reason !== 'selected_ticket'){
          /* The selection is cleared only when the turn really brought a NEW
             ticket context (a different structured filter set, an ambiguous
             multi-list turn) or reported that the ticket is gone. A plain
             text answer, a legacy-tool search and a «no list» turn carry no
             new single-ticket context of their own: keeping the selection
             alive is what makes «список → 3 заявку → який адрес? → дай
             карточку» reach the exact ticket. */
          const newTicketContext = resultStatus.subjectChanged === true &&
            resultStatus.reason !== 'legacy_tool' && resultStatus.reason !== 'no_list_result';
          if(newTicketContext || resultStatus.reason === 'TICKET_NO_LONGER_AVAILABLE') selectedTicketId = null;
        }
        /* A turn whose ticket context differs from the stored list (other
           filters, another search, no structured filters at all) invalidates
           that list: «покажи 11-ю» must never silently resolve against a list
           the conversation already left. Turns that select FROM the stored state
           (reason 'selected_ticket') keep it. */
        if(activeResultSet && resultStatus && resultStatus.subjectChanged === true && resultStatus.reason !== 'selected_ticket'
           && (resultStatus.filtersKey == null || resultStatus.filtersKey !== activeResultSet.filtersKey)){
          activeResultSet = null;
        }
      }
      messages.push({ role:'assistant', text:safeHistoryText(outcome.answer), ts:Date.now(), meta:outcome.meta, total:outcome.total, tickets:safeTickets(outcome.tickets), referentTickets:safeReferent(outcome.referentTickets), queryContext:(outcome.queryContext && typeof outcome.queryContext === 'object' && !Array.isArray(outcome.queryContext)) ? outcome.queryContext : null });
      let emittedResultItems = outcome.resultItems || [];
      let emittedPresentation = outcome.presentation || null;
      if(!persist()){
        activeResultSet = null;
        selectedTicketId = null;
        emittedResultItems = [];
        emittedPresentation = null;
        emit('state_degraded');
      }
      emit('assistant', { text:outcome.answer, meta:outcome.meta, total:outcome.total, shown:outcome.shown, tickets:outcome.tickets || [], referentTickets:outcome.referentTickets || [], localQuery:outcome.localQuery || null, resultItems:emittedResultItems, presentation:emittedPresentation });
      return { ok:true };
    }
    lastFailed = question;
    /* 429/TPM: cooldown виставляється ДО emit('error'), щоб UI одразу
       заблокував Send/Retry. Ніяких автоматичних повторних відправок;
       історія не ламається (error-рядки в контекст не потрапляють). */
    const isRateLimit = outcome.error && outcome.error.kind === 'rate_limit';
    /* Точний час є -> ставимо cooldown; немає -> cooldown НЕ виставляємо,
       Send/Retry лишаються доступні (ручний повтор без брехливого відліку). */
    const waitSec = isRateLimit ? cooldownSec(outcome.error) : 0;
    if(isRateLimit) cooldownUntil = waitSec > 0 ? Date.now() + waitSec * 1000 : 0;
    messages.push({ role:'error', text:outcome.error.message, ts:Date.now() });
    /* Один rate-limit стан на один pending-запит: UI оновлює ОДНУ плашку
       ліміту замість нової червоної бульбашки на кожен 429. */
    if(isRateLimit && typeof hooks.rate_limit === 'function'){
      emit('rate_limit', { sec: waitSec, message: outcome.error.message, retryAfterSec: outcome.error.retryAfterSec || null });
    }else{
      /* Немає спеціального хука (старіші споживачі) — помилка НЕ губиться. */
      emit('error', outcome.error);
    }
    if(isRateLimit && waitSec > 0) emit('cooldown', { sec: cooldownRemainingSec() });
    return { ok:false, error:outcome.error };
  }
  async function retry(){ return lastFailed ? send(lastFailed, { isRetry:true }) : { ok:false, skipped:true }; }
  function clear(){
    messages = []; lastFailed = null; cooldownUntil = 0; activeResultSet = null; selectedTicketId = null; chatSessionId = newSessionId();
    if(historyStorage){ try{ historyStorage.removeItem(HISTORY_KEY); }catch(_e){} }
    emit('cleared');
  }
  function history(){ return messages.slice(); }
  function isBusy(){ return busy; }
  function canRetry(){ return !!lastFailed; }
  function invalidateSelection(){ selectedTicketId = null; persist(); }
  return { send: send, retry: retry, clear: clear, history: history, isBusy: isBusy, canRetry: canRetry, cooldownRemainingSec: cooldownRemainingSec, invalidateSelection:invalidateSelection };
};
})();
