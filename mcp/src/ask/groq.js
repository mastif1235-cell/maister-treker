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

export function createGroqClient(options){
  const fetchImpl = options.fetchImpl;
  const apiKey = String(options.apiKey || '');
  const model = String(options.model || 'openai/gpt-oss-120b');
  const timeoutMs = Number(options.timeoutMs) || 30000;
  const maxTokens = Number(options.maxTokens) || 2048;
  const temperature = options.temperature == null ? 0.2 : Number(options.temperature);

  async function chat(messages, tools){
    const controller = new AbortController();
    const timer = setTimeout(function(){ controller.abort(); }, timeoutMs);
    let response;
    try{
      response = await fetchImpl(GROQ_CHAT_URL, {
        method:'POST',
        signal:controller.signal,
        headers:{'Content-Type':'application/json', Authorization:'Bearer ' + apiKey},
        body:JSON.stringify({model, messages, tools, tool_choice:'auto', temperature, max_tokens:maxTokens})
      });
    }catch(err){
      return {ok:false, code:'NETWORK', message:String(err && err.name || err)};
    }finally{
      clearTimeout(timer);
    }
    if(!response.ok) return {ok:false, code:'HTTP_' + response.status, message:'Groq responded ' + response.status};
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
