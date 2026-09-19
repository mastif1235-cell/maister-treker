/* AI: логіка чату (стан сесії, надсилання, повтор, помилки). Чиста —
   DOM вводиться через колбеки, тому покривається unit-тестами. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
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
    if(!historyStorage) return [];
    try{
      const raw = JSON.parse(historyStorage.getItem(HISTORY_KEY) || '[]');
      if(!Array.isArray(raw)) return [];
      return raw.slice(-40).filter(function(m){ return m && (m.role === 'user' || m.role === 'assistant') && safeHistoryText(m.text); }).map(function(m){
        return {role:m.role, text:safeHistoryText(m.text), ts:Number(m.ts)||Date.now(), tickets:safeTickets(m.tickets), referentTickets:safeReferent(m.referentTickets), queryContext:(m.queryContext && typeof m.queryContext === 'object' && !Array.isArray(m.queryContext)) ? m.queryContext : null};
      });
    }catch(_e){ return []; }
  }
  let messages = loadPersisted();       // {role:'user'|'assistant'|'error', text, ts, tickets?}
  function safeTickets(raw){
    if(!Array.isArray(raw)) return [];
    return raw.slice(0,8).map(function(t){
      if(!t || typeof t !== 'object') return null;
      const id=String(t.id == null ? '' : t.id).trim().slice(0,64);
      if(!id || !/^[0-9a-zA-Z_-]{1,64}$/.test(id)) return null;
      return {id:id,date:String(t.date||'').slice(0,32),time:String(t.time||'').slice(0,16),address:String(t.address||'').slice(0,200),type:String(t.type||'').slice(0,100),sum:String(t.sum||'').slice(0,16),signal:String(t.signal||'').slice(0,32),note:String(t.note||'').slice(0,120)};
    }).filter(Boolean);
  }
  /* Прихований referent: МИНІМАЛЬНИЙ безпечний набір БЕЗ note/phone/geo —
     лише для розв'язання посилання наступного turn і відкриття заявки. */
  function safeReferent(raw){
    if(!Array.isArray(raw)) return [];
    return raw.slice(0,8).map(function(t){
      if(!t || typeof t !== 'object') return null;
      const id=String(t.id == null ? '' : t.id).trim().slice(0,64);
      if(!id || !/^[0-9a-zA-Z_-]{1,64}$/.test(id)) return null;
      return {id:id,date:String(t.date||'').slice(0,32),time:String(t.time||'').slice(0,16),address:String(t.address||'').slice(0,200),type:String(t.type||'').slice(0,100),sum:String(t.sum||'').slice(0,16),signal:String(t.signal||'').slice(0,32)};
    }).filter(Boolean);
  }
  function persist(){
    if(!historyStorage) return;
    try{ historyStorage.setItem(HISTORY_KEY, JSON.stringify(messages.filter(function(m){ return m.role === 'user' || m.role === 'assistant'; }).slice(-40))); }catch(_e){}
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
    let referent = [];
    let followUpQueryContext = null;
    for(let i = messages.length - 1; i >= 0; i--){
      const m = messages[i];
      if(m.role !== 'assistant') continue;
      if(!referent.length){
        const ref = (Array.isArray(m.referentTickets) && m.referentTickets.length) ? m.referentTickets
          : (Array.isArray(m.tickets) && m.tickets.length ? m.tickets : []);
        if(ref.length) referent = ref;
      }
      if(!followUpQueryContext && m.queryContext && typeof m.queryContext === 'object') followUpQueryContext = m.queryContext;
      if(referent.length && followUpQueryContext) break;
    }
    if(!isRetry){ messages.push({ role:'user', text:safeHistoryText(question), ts:Date.now() }); persist(); }
    /* v91.46: структурований follow-up контекст (авторитетні фільтри
       попереднього query_tickets) — «покажи їх» успадковує ТІ САМІ фільтри
       на свіжому READ; повторно валідується клієнтом і сервером. */
    let outcome = await client.ask(question, history, { tickets: referent, queryContext: followUpQueryContext });
    busy = false;
    emit('busy', false);
    if(outcome.ok){
      /* Успіх (у т.ч. успішний ручний retry): і lastFailed, і cooldown
         скидаються — інакше прострочений cooldownUntil міг би блокувати
         наступний send(), а stale lastFailed тримав би живою кнопку Retry. */
      lastFailed = null; cooldownUntil = 0;
      messages.push({ role:'assistant', text:safeHistoryText(outcome.answer), ts:Date.now(), meta:outcome.meta, total:outcome.total, tickets:safeTickets(outcome.tickets), referentTickets:safeReferent(outcome.referentTickets), queryContext:(outcome.queryContext && typeof outcome.queryContext === 'object' && !Array.isArray(outcome.queryContext)) ? outcome.queryContext : null });
      persist();
      emit('assistant', { text:outcome.answer, meta:outcome.meta, total:outcome.total, tickets:outcome.tickets || [], referentTickets:outcome.referentTickets || [], localQuery:outcome.localQuery || null });
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
    messages = []; lastFailed = null; cooldownUntil = 0;
    if(historyStorage){ try{ historyStorage.removeItem(HISTORY_KEY); }catch(_e){} }
    emit('cleared');
  }
  function history(){ return messages.slice(); }
  function isBusy(){ return busy; }
  function canRetry(){ return !!lastFailed; }
  return { send: send, retry: retry, clear: clear, history: history, isBusy: isBusy, canRetry: canRetry, cooldownRemainingSec: cooldownRemainingSec };
};
})();
