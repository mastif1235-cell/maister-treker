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

   Tool descriptions for DeepSeek:
   DeepSeek API rejects requests when all 9 tools carry long canonical
   descriptions (HTTP 400). We provide concise, high-signal function descriptions
   for DeepSeek while preserving the exact canonical parameters/schemas and
   without mutating the global TOOL_DEFINITIONS used by Groq and native MCP.

   The API key travels ONLY in the Authorization header. It is never logged,
   never placed into the request body, never returned in errors and never
   stored anywhere by this module. */

const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/chat/completions';

export const DEEPSEEK_COMPACT_DESCRIPTIONS = {
  list_tickets: 'Список заявок із фільтрами за датами, типом, сигналом та тегами',
  get_ticket: 'Одна заявка за ID',
  search_tickets: 'Пошук заявок за текстом, адресою, клієнтом, телефоном, сигналом та тегами',
  find_tickets_by_address: 'Пошук заявок за адресою з підтримкою варіантів українського та російського написання',
  list_places: 'Відомі міста, села, вулиці та будинки із заявок',
  get_tickets_by_date: 'Усі заявки за конкретну дату',
  get_shifts: 'Робочі зміни, години та напарники',
  get_reports: 'Денні підсумки: кількість, сума, готівка та безготівка',
  get_statistics: 'Агрегована статистика за день, тиждень, місяць або весь час'
};

export function formatDeepSeekTools(tools){
  if(!Array.isArray(tools) || !tools.length) return undefined;
  return tools.map(function(tool){
    if(!tool || typeof tool !== 'object') return tool;
    const fn = tool.function;
    if(!fn || typeof fn !== 'object') return tool;
    const name = fn.name;
    const compactDesc = DEEPSEEK_COMPACT_DESCRIPTIONS[name] || String(fn.description || '').slice(0, 120);
    return {
      type: tool.type || 'function',
      function: {
        name: name,
        description: compactDesc,
        parameters: fn.parameters
      }
    };
  });
}

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

function diagnosticMessageShape(message){
  const item = message && typeof message === 'object' ? message : {};
  const contentState = Object.prototype.hasOwnProperty.call(item, 'content')
    ? (item.content === null ? 'null' : 'string')
    : 'absent';
  const calls = Array.isArray(item.tool_calls) ? item.tool_calls : [];
  return {
    role: typeof item.role === 'string' ? item.role : 'absent',
    content_state: contentState,
    content_length: typeof item.content === 'string' ? item.content.length : 0,
    has_tool_calls: calls.length > 0,
    tool_calls_count: calls.length,
    has_tool_call_id: typeof item.tool_call_id === 'string' && item.tool_call_id.length > 0
  };
}

function diagnosticRequestShape(body, round){
  return {
    round: Number.isInteger(round) && round > 0 ? round : null,
    model: body.model,
    messages_count: Array.isArray(body.messages) ? body.messages.length : 0,
    messages: Array.isArray(body.messages) ? body.messages.map(diagnosticMessageShape) : [],
    tools_count: Array.isArray(body.tools) ? body.tools.length : 0,
    tool_choice: body.tool_choice == null ? null : body.tool_choice,
    thinking_type: body.thinking && typeof body.thinking.type === 'string' ? body.thinking.type : null
  };
}

export function createDeepSeekClient(options){
  const fetchImpl = options.fetchImpl || fetch;
  const apiKey = String(options.apiKey || '');
  const model = String(options.model || 'deepseek-flash').trim() || 'deepseek-flash';
  const timeoutMs = Number(options.timeoutMs) || 30000;
  const maxTokens = Number(options.maxTokens) || 4096;
  const temperature = options.temperature == null ? null : Number(options.temperature);

  async function chat(messages, tools, diagnostic){
    const controller = new AbortController();
    const timer = setTimeout(function(){ controller.abort(); }, timeoutMs);
    let response;
    const formattedTools = formatDeepSeekTools(tools);
    try{
      const reqBody = Object.assign(
        {
          model: model,
          thinking: { type: 'disabled' },
          messages: messages,
          tools: formattedTools,
          tool_choice: formattedTools && formattedTools.length ? 'auto' : undefined,
          max_tokens: maxTokens
        },
        temperature == null ? {} : {temperature}
      );
      const diagnosticBody = diagnosticRequestShape(reqBody, diagnostic && diagnostic.round);
      console.info('[ask] deepseek diagnostic request', JSON.stringify(diagnosticBody));
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

    if(response && response.ok){
      console.info('[ask] deepseek diagnostic response', JSON.stringify({
        round: diagnostic && diagnostic.round,
        status: response.status
      }));
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
      let providerMeta = {};
      try{
        const parsed = JSON.parse(raw);
        const error = parsed && parsed.error;
        if(error && typeof error === 'object'){
          if(typeof error.code === 'string') providerMeta.code = error.code.slice(0, 100);
          if(typeof error.type === 'string') providerMeta.type = error.type.slice(0, 100);
          if(typeof error.param === 'string') providerMeta.param = error.param.slice(0, 100);
        }
      }catch(_err){}
      console.error('[ask] deepseek diagnostic response', JSON.stringify({
        round: diagnostic && diagnostic.round,
        status: response.status,
        provider_error: providerMeta
      }));
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
