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
  let messages = [];       // {role:'user'|'assistant'|'error', text, ts}
  let busy = false;
  let lastFailed = null;   // останнє питання, яке впало (для «Повторити»)
  let cooldownUntil = 0;   // 429/TPM: until-таймстемп, доки Send/Retry заблоковані
  /* Тривалість cooldown (сек): з Retry-After (якщо бекенд дав), інакше
     дефолт; тримається у вікні 20–30 с. У тестах можна перевизначити. */
  const cooldownSec = typeof deps.cooldownSec === 'function'
    ? deps.cooldownSec
    : function(err){ return Math.min(Math.max(err && err.retryAfterSec ? err.retryAfterSec + 2 : 25, 20), 30); };
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
    if(!isRetry) messages.push({ role:'user', text:question, ts:Date.now() });
    let outcome = await client.ask(question, history);
    busy = false;
    emit('busy', false);
    if(outcome.ok){
      lastFailed = null;
      messages.push({ role:'assistant', text:outcome.answer, ts:Date.now(), meta:outcome.meta, tickets:outcome.tickets || [] });
      emit('assistant', { text:outcome.answer, meta:outcome.meta, tickets:outcome.tickets || [] });
      return { ok:true };
    }
    lastFailed = question;
    /* 429/TPM: cooldown виставляється ДО emit('error'), щоб UI одразу
       заблокував Send/Retry. Ніяких автоматичних повторних відправок;
       історія не ламається (error-рядки в контекст не потрапляють). */
    const isRateLimit = outcome.error && outcome.error.kind === 'rate_limit';
    if(isRateLimit) cooldownUntil = Date.now() + cooldownSec(outcome.error) * 1000;
    messages.push({ role:'error', text:outcome.error.message, ts:Date.now() });
    emit('error', outcome.error);
    if(isRateLimit) emit('cooldown', { sec: cooldownRemainingSec() });
    return { ok:false, error:outcome.error };
  }
  async function retry(){ return lastFailed ? send(lastFailed, { isRetry:true }) : { ok:false, skipped:true }; }
  function clear(){
    messages = []; lastFailed = null; cooldownUntil = 0;
    emit('cleared');
  }
  function history(){ return messages.slice(); }
  function isBusy(){ return busy; }
  function canRetry(){ return !!lastFailed; }
  function clear(){
    messages = []; lastFailed = null; cooldownUntil = 0;
    emit('cleared');
  }
  return { send: send, retry: retry, clear: clear, history: history, isBusy: isBusy, canRetry: canRetry, cooldownRemainingSec: cooldownRemainingSec };
};
})();
