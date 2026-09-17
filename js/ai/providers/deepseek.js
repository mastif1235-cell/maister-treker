/* AI provider: DeepSeek (ЗАГОтОВКА, вимкнений).
   Активація пізніше = 1) додати allowlist-хост у CSP + ai-config (наш
   Worker і надалі єдиний бекенд), 2) на Worker: маршрутизація provider/model
   за контрактом mcp/docs/ai-multimodal-contract.md (ключ-секрет — тільки
   там, ім'я в docs), 3) enabled:true тут. UI/чат/налаштування змін не
   потребують. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.providers.register({
  id: 'deepseek',
  name: 'DeepSeek',
  enabled: false, // ← стане true після підключення на backend (окремий етап)
  backendProfile: { note: 'upstream викликається лише всередині нашого Worker\u2019а; ключ — Worker Secret (ім\u2019я див. у docs)' },
  capabilities: { text:true, vision:false, audioInput:false, tools:true, reasoning:true },
  models: [
    { id:'deepseek-chat',     label:'DeepSeek Chat',     capabilities:{ text:true, tools:true, reasoning:false } },
    { id:'deepseek-reasoner', label:'DeepSeek Reasoner', capabilities:{ text:true, tools:true, reasoning:true } }
  ]
});
})();
