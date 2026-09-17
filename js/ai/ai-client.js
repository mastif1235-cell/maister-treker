/* AI: клієнт нашого backend (єдині точки — POST /ask і GET /healthz).
   Нічого не знає про Groq/DeepSeek: upstream схований на Worker'і.
   Чистий модуль без DOM — покривається unit-тестами (mock fetch). */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.createClient = function(options){
  const fetchImpl = options.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const getConfig = options.getConfig; // () => ({backendUrl, bearer, model, provider})
  const timeoutMs = (options.timeoutMs || MTAI.config.LIMITS.timeoutMs);

  function parseRetryAfter(text){
    const t = String(text || '');
    let m = /(\d{1,3})\s*(?:секунд|секунди|сек|seconds?|sec)/i.exec(t);
    if(!m) m = /retry[-\s]?after\D{0,12}(\d{1,3})/i.exec(t);
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
    if(status === 429 || /rate limit/i.test(detail)){
      return { kind:'rate_limit',
        message:'Ліміт Groq (TPM, безкоштовний тариф).' + (parseRetryAfter(detail) ? ' Просить зачекати ~' + parseRetryAfter(detail) + ' с.' : ' Спробуйте за 20–30 секунд.'),
        detail: detail, retryAfterSec: parseRetryAfter(detail) };
    }
    if(status === 503) return { kind:'not_configured', message:'Сервер повідомив: ' + ((payload && (payload.error || code)) || 'ask_not_configured') + '.', detail: detail };
    if(status === 400) return { kind:'bad_request', message:'Некоректний запит (' + code + ').', detail: detail };
    if(status >= 500) return { kind:'server', message:'Помилка сервера (' + status + (code ? ' ' + code : '') + ').', detail: detail };
    return { kind:'http', message:'Помилка ' + status + (code ? ' ' + code : '') + '.', detail: detail };
  }

  async function ask(question){
    const cfg = getConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(function(){ ctrl.abort(); }, timeoutMs);
    try{
      const res = await fetchImpl(cfg.backendUrl + '/ask', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + cfg.bearer },
        body: JSON.stringify({ question: String(question).slice(0, MTAI.config.LIMITS.questionMaxChars) }),
        signal: ctrl.signal
      });
      const payload = await res.json().catch(function(){ return null; });
      if(res.ok && payload && payload.ok){
        return { ok:true, answer:String(payload.answer || ''), meta: payload.meta || {} };
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

  return { ask: ask, health: health };
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