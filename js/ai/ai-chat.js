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

  function emit(name, payload){ if(typeof hooks[name] === 'function') hooks[name](payload); }

  async function send(text, opts){
    const question = String(text == null ? '' : text).trim().slice(0, MTAI.config.LIMITS.questionMaxChars);
    if(!question || busy) return { ok:false, skipped:true };
    if(attachments && attachments.count() && !capabilities().vision){
      const err = { kind:'attachments_unsupported',
        message:'Бекенд поки не приймає зображення (контракт у розробці, див. mcp/docs/ai-multimodal-contract.md). Надішліть питання текстом або приберіть вкладення.' };
      emit('error', err);
      return { ok:false, error: err };
    }
    busy = true; lastFailed = null;
    emit('busy', true);
    emit('user', question);
    messages.push({ role:'user', text:question, ts:Date.now() });
    let outcome = await client.ask(question);
    /* Один авто-ретрай для rate_limit з урахуванням retryAfterSec (макс 35 с). */
    if(!outcome.ok && outcome.error.kind === 'rate_limit'){
      const wait = Math.min(outcome.error.retryAfterSec ? outcome.error.retryAfterSec + 3 : 25, 35);
      emit('wait', wait);
      await sleep(wait * 1000);
      outcome = await client.ask(question);
    }
    busy = false;
    emit('busy', false);
    if(outcome.ok){
      lastFailed = null;
      messages.push({ role:'assistant', text:outcome.answer, ts:Date.now(), meta:outcome.meta, tickets:outcome.tickets || [] });
      emit('assistant', { text:outcome.answer, meta:outcome.meta, tickets:outcome.tickets || [] });
      return { ok:true };
    }
    lastFailed = question;
    messages.push({ role:'error', text:outcome.error.message, ts:Date.now() });
    emit('error', outcome.error);
    return { ok:false, error:outcome.error };
  }
  async function retry(){ return lastFailed ? send(lastFailed, { isRetry:true }) : { ok:false, skipped:true }; }
  function clear(){ messages = []; lastFailed = null; emit('cleared'); }
  function history(){ return messages.slice(); }
  function isBusy(){ return busy; }
  function canRetry(){ return !!lastFailed; }
  return { send: send, retry: retry, clear: clear, history: history, isBusy: isBusy, canRetry: canRetry };
};
})();
