/* AI provider: DeepSeek (активний). Ключі DeepSeek живуть ТІЛЬКИ на Cloudflare
   Worker — PWA спілкується виключно з нашим /ask (деталі upstream —
   в mcp/docs/ai-multimodal-contract.md, у фронтенді їх свідомо немає). */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.providers.register({
  id: 'deepseek',
  name: 'DeepSeek',
  enabled: true,
  backendProfile: { note: 'upstream викликається лише всередині нашого Worker\u2019а; ключ — Worker Secret (ім\u2019я див. у docs)' },
  capabilities: { text:true, vision:false, audioInput:false, tools:true, reasoning:false },
  models: [
    { id:'deepseek-flash', label:'deepseek-flash', capabilities:{ text:true, tools:true, reasoning:false } }
  ]
});
})();
