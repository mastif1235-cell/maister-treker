/* AI: фасад провайдера для UI — активний провайдер, вибір моделі,
   можливості (capabilities) і рядок статусу. Чиста логіка, без DOM. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.provider = (function(){
  function ensure(storage){
    const cfg = storage.get();
    if(!MTAI.providers.get(cfg.provider)) cfg.provider = MTAI.config.DEFAULT_PROVIDER;
    const provider = MTAI.providers.get(cfg.provider);
    const hasModel = provider.models.some(function(m){ return m.id === cfg.model; });
    if(!hasModel) cfg.model = (provider.models[0] || { id: MTAI.config.DEFAULT_MODEL }).id;
    return cfg;
  }
  function capabilities(storage){
    const cfg = ensure(storage);
    const provider = MTAI.providers.get(cfg.provider);
    const model = provider.models.find(function(m){ return m.id === cfg.model; }) || provider.models[0];
    return model ? model.capabilities : provider.capabilities;
  }
  /* Рядок статусу для чату/налаштувань: "Provider · Model · Backend · Mode". */
  function statusLine(storage, backendOnline){
    const cfg = ensure(storage);
    const provider = MTAI.providers.get(cfg.provider);
    return {
      provider: provider.name,
      model: cfg.model,
      modelCaps: capabilities(storage),
      backend: cfg.backendUrl,
      backendOnline: backendOnline === true,
      mode: 'READ-ONLY'
    };
  }
  function capsLabel(caps){
    const parts = [];
    if(caps && caps.text) parts.push('Текст');
    if(caps && caps.vision) parts.push('Фото');
    if(caps && caps.reasoning) parts.push('Reasoning');
    if(caps && caps.tools) parts.push('Tools');
    return parts.join(' · ') || '—';
  }
  return { ensure: ensure, capabilities: capabilities, statusLine: statusLine, capsLabel: capsLabel };
})();
})();
