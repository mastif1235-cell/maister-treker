/* AI provider: Groq (активний). Ключі Groq живуть ТІЛЬКИ на Cloudflare
   Worker — PWA спілкується виключно з нашим /ask (деталі upstream —
   в mcp/docs/ai-multimodal-contract.md, у фронтенді їх свідомо немає). */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.providers.register({
  id: 'groq',
  name: 'Groq',
  enabled: true,
  backendProfile: { note: 'upstream викликається лише всередині нашого Worker\u2019а; ключ — Worker Secret (ім\u2019я див. у docs)' },
  capabilities: { text:true, vision:false, audioInput:false, tools:true, reasoning:true },
  models: [
    { id:'openai/gpt-oss-120b', label:'GPT-OSS 120B', capabilities:{ text:true, tools:true, reasoning:true } }
    /* Нові моделі Groq додаються одним рядком тут — UI підхопить автоматично. */
  ]
});
})();
