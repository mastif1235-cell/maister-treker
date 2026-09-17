/* Groq chat-completions client for the /ask orchestrator.
   Uses the OpenAI-compatible tool-calling format documented by Groq for
   openai/gpt-oss-120b (console.groq.com/docs/tool-use):
     POST https://api.groq.com/openai/v1/chat/completions
     body: {model, messages, tools:[{type:'function', function:{...}}],
            tool_choice:'auto'}
     reply: choices[0].message may contain
            tool_calls:[{id, type:'function', function:{name, arguments}}]
   The API key travels ONLY in the Authorization header. It is never logged,
   never placed into the request body, never returned in errors and never
   stored anywhere by this module. */

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/* Redacts anything that could be a secret from a Groq error body before it
   is logged or returned to clients: our own key value, gsk_… lookalikes and
   Bearer/sk token-like strings. Caps the length. */
function sanitizeDetail(text, apiKey){
  let out = String(text || '');
  if(apiKey && out.indexOf(apiKey) !== -1) out = out.split(apiKey).join('[redacted]');
  out = out.replace(/gsk_[A-Za-z0-9_-]{8,}/g, '[redacted]');
  out = out.replace(/\b(sk|Bearer)[\s_-]+[A-Za-z0-9._-]{16,}/gi, '[redacted]');
  out = out.replace(/\s+/g, ' ').trim();
  return out.slice(0, 400);
}

/* Groq documents (console.groq.com/docs/rate-limits):
     retry-after                 -> seconds, set ONLY on 429
     x-ratelimit-reset-tokens    -> TPM reset, duration string ("7.66s")
     x-ratelimit-reset-requests  -> RPD reset, duration string ("2m59.56s")
   Durations may be "1m30s", "500ms", "2m59.56s" or a bare number of seconds.
   Returns whole seconds (ceil, >=1) or null when nothing parseable is there.
   NOTE: only this normalized NUMBER ever reaches the client — raw upstream
   headers are never forwarded. */
export function parseDurationSeconds(value){
  if(value == null) return null;
  const text = String(value).trim().toLowerCase();
  if(!text) return null;
  if(/^\d+(?:\.\d+)?$/.test(text)){
    const plain = Number(text);
    return isFinite(plain) && plain > 0 ? Math.max(1, Math.ceil(plain)) : null;
  }
  const units = {ms:0.001, s:1, m:60, h:3600};
  let total = 0;
  let matched = false;
  for(const part of text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g)){
    const amount = Number(part[1]);
    if(!isFinite(amount)) continue;
    total += amount * units[part[2]];
    matched = true;
  }
  if(!matched || total <= 0) return null;
  return Math.max(1, Math.ceil(total));
}

/* The wait a 429 really implies: retry-after first (authoritative), then the
   token/request reset hints. Never invents a value. */
export function retryAfterFromHeaders(headers){
  if(!headers || typeof headers.get !== 'function') return null;
  const direct = parseDurationSeconds(headers.get('retry-after'));
  if(direct != null) return direct;
  const resetTokens = parseDurationSeconds(headers.get('x-ratelimit-reset-tokens'));
  const resetRequests = parseDurationSeconds(headers.get('x-ratelimit-reset-requests'));
  const candidates = [resetTokens, resetRequests].filter(function(v){ return v != null; });
  if(!candidates.length) return null;
  return Math.max.apply(null, candidates);
}

/* Last resort: Groq sometimes phrases the wait only in the error message
   ("Please try again in 7.66s" / "in 1m30s"). */
export function retryAfterFromMessage(text){
  /* Matches "in 7.66s", "in 1m30s", "in 12s" — the unit suffix is required so
     a trailing sentence dot can never be swallowed as a decimal point. */
  const m = /try again in\s+((?:\d+(?:\.\d+)?\s*(?:ms|h|m|s))+)/i.exec(String(text || ''));
  return m ? parseDurationSeconds(m[1]) : null;
}

export function createGroqClient(options){
  const fetchImpl = options.fetchImpl;
  const apiKey = String(options.apiKey || '');
  const model = String(options.model || 'openai/gpt-oss-120b');
  const timeoutMs = Number(options.timeoutMs) || 30000;
  /* gpt-oss on Groq documents max_completion_tokens (bare max_tokens is
     rejected by newer OpenAI-format models with HTTP 400) and requires
     reasoning_format "parsed" or "hidden" when tools are used — "hidden"
     keeps reasoning out of the assistant messages we echo back in the tool
     loop. temperature is omitted unless set explicitly, so the model's
     documented default applies. 4096 leaves ample room for hidden reasoning
     plus a short data answer while halving the per-call completion reserve
     (Groq free tier is 8000 TPM for this model). */
  const maxTokens = Number(options.maxTokens) || 4096;
  const temperature = options.temperature == null ? null : Number(options.temperature);
  const reasoningFormat = String(options.reasoningFormat || 'hidden');

  async function chat(messages, tools){
    const controller = new AbortController();
    const timer = setTimeout(function(){ controller.abort(); }, timeoutMs);
    let response;
    try{
      response = await fetchImpl(GROQ_CHAT_URL, {
        method:'POST',
        signal:controller.signal,
        headers:{'Content-Type':'application/json', Authorization:'Bearer ' + apiKey},
        body:JSON.stringify(Object.assign(
          {model, messages, tools, tool_choice:'auto', reasoning_format:reasoningFormat, max_completion_tokens:maxTokens},
          temperature == null ? {} : {temperature}
        ))
      });
    }catch(err){
      return {ok:false, code:'NETWORK', message:String(err && err.name || err)};
    }finally{
      clearTimeout(timer);
    }
    if(!response.ok){
      /* Keep a SHORT, sanitized excerpt of Groq's error body: it names the
         exact 4xx cause (unsupported param, model limits). The API key and
         token lookalikes are redacted before logging / returning. */
      let raw = '';
      try{ raw = await response.text(); }catch(_err){ raw = ''; }
      let detail = raw;
      try{
        const parsed = JSON.parse(raw);
        if(parsed && parsed.error && typeof parsed.error.message === 'string') detail = parsed.error.message;
      }catch(_err){ /* non-JSON body: keep sanitized raw text */ }
      detail = sanitizeDetail(detail, apiKey);
      console.error('[ask] groq http error:', response.status, detail);
      const result = {ok:false, code:'HTTP_' + response.status, message:'Groq responded ' + response.status, detail};
      /* 429: keep the REAL wait Groq asks for (header first, message as a
         fallback) so the UI can show a truthful countdown instead of a
         made-up 20-30 s. Only the number is kept — no raw headers. */
      if(response.status === 429){
        const wait = retryAfterFromHeaders(response.headers);
        result.retryAfterSeconds = wait != null ? wait : retryAfterFromMessage(detail);
      }
      return result;
    }
    let data;
    try{ data = JSON.parse(await response.text()); }
    catch(_err){ return {ok:false, code:'MALFORMED', message:'Groq returned non-JSON payload'}; }
    const choice = data && Array.isArray(data.choices) && data.choices[0];
    const message = choice && choice.message;
    if(!message) return {ok:false, code:'MALFORMED', message:'Groq payload has no message'};
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls = [];
    for(const call of rawCalls){
      const fn = call && typeof call === 'object' ? call.function : null;
      if(!fn || typeof fn.name !== 'string') continue;
      toolCalls.push({
        id: typeof call.id === 'string' && call.id ? call.id : ('call_' + toolCalls.length),
        name: fn.name,
        argsRaw: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments == null ? {} : fn.arguments)
      });
    }
    return {
      ok:true,
      content: typeof message.content === 'string' ? message.content : '',
      toolCalls,
      assistantMessage: message
    };
  }

  return {chat};
}
