/* DeepSeek chat-completions client for the /ask orchestrator.
   Uses the official DeepSeek OpenAI-compatible API (https://api.deepseek.com):
     POST https://api.groq.com/openai/v1/chat/completions -> DeepSeek equivalent:
     POST https://api.deepseek.com/chat/completions
     body: {model: 'deepseek-flash', thinking: {type: 'disabled'}, messages,
            tools:[{type:'function', function:{...}}],
            tool_choice:'auto', max_tokens:4096}
     reply: choices[0].message may contain
            tool_calls:[{id, type:'function', function:{name, arguments}}]

   Non-thinking mode:
   Explicitly passes `thinking: { type: 'disabled' }` to use fast direct execution
   without reasoning preamble, ideal for field ticket/address lookups.

   The API key travels ONLY in the Authorization header. It is never logged,
   never placed into the request body, never returned in errors and never
   stored anywhere by this module. */

const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';

function sanitizeDetail(text, apiKey){
  let out = String(text || '');
  if(apiKey && out.indexOf(apiKey) !== -1) out = out.split(apiKey).join('[redacted]');
  out = out.replace(/sk-[A-Za-z0-9_-]{16,}/g, '[redacted]');
  out = out.replace(/\b(sk|Bearer)[\s_-]+[A-Za-z0-9._-]{16,}/gi, '[redacted]');
  out = out.replace(/\s+/g, ' ').trim();
  return out.slice(0, 400);
}

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

export function retryAfterFromHeaders(headers){
  if(!headers || typeof headers.get !== 'function') return null;
  const direct = parseDurationSeconds(headers.get('retry-after'));
  return direct;
}

export function createDeepSeekClient(options){
  const fetchImpl = options.fetchImpl || fetch;
  const apiKey = String(options.apiKey || '');
  const model = String(options.model || 'deepseek-flash').trim() || 'deepseek-flash';
  const timeoutMs = Number(options.timeoutMs) || 30000;
  const maxTokens = Number(options.maxTokens) || 4096;
  const temperature = options.temperature == null ? null : Number(options.temperature);

  async function chat(messages, tools){
    const controller = new AbortController();
    const timer = setTimeout(function(){ controller.abort(); }, timeoutMs);
    let response;
    try{
      const reqBody = Object.assign(
        {
          model: model,
          thinking: { type: 'disabled' },
          messages: messages,
          tools: tools && tools.length ? tools : undefined,
          tool_choice: tools && tools.length ? 'auto' : undefined,
          max_tokens: maxTokens
        },
        temperature == null ? {} : {temperature}
      );
      response = await fetchImpl(DEEPSEEK_CHAT_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(reqBody)
      });
    }catch(err){
      return {ok:false, code:'NETWORK', message:String(err && err.name || err)};
    }finally{
      clearTimeout(timer);
    }

    if(!response.ok){
      let raw = '';
      try{ raw = await response.text(); }catch(_err){ raw = ''; }
      let detail = raw;
      try{
        const parsed = JSON.parse(raw);
        if(parsed && parsed.error && typeof parsed.error.message === 'string') detail = parsed.error.message;
      }catch(_err){}
      detail = sanitizeDetail(detail, apiKey);
      console.error('[ask] deepseek http error:', response.status, detail);
      const result = {ok:false, code:'HTTP_' + response.status, message:'DeepSeek responded ' + response.status, detail};
      if(response.status === 429){
        const wait = retryAfterFromHeaders(response.headers);
        result.retryAfterSeconds = wait != null ? wait : 10;
      }
      return result;
    }

    let data;
    try{ data = JSON.parse(await response.text()); }
    catch(_err){ return {ok:false, code:'MALFORMED', message:'DeepSeek returned non-JSON payload'}; }
    const choice = data && Array.isArray(data.choices) && data.choices[0];
    const message = choice && choice.message;
    if(!message) return {ok:false, code:'MALFORMED', message:'DeepSeek payload has no message'};
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
      ok: true,
      content: typeof message.content === 'string' ? message.content : '',
      toolCalls: toolCalls,
      assistantMessage: message
    };
  }

  return {chat};
}
