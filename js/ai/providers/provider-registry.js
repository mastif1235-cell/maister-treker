/* AI: реєстр провайдерів. Новий провайдер = один adapter-файл + register().
   UI читає список звідси і не знає про конкретні API. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.providers = (function(){
  const byId = Object.create(null);
  function register(def){
    if(!def || typeof def.id !== 'string' || !def.id) throw new Error('provider id required');
    byId[def.id] = {
      id: def.id,
      name: String(def.name || def.id),
      enabled: def.enabled !== false,
      /* backendProfile: як бекенд викликає цього провайдера (клієнт PWA
         ніколи не бачить цих URL/ключів — вони лише для документування). */
      backendProfile: def.backendProfile || null,
      capabilities: Object.assign({ text:true, vision:false, audioInput:false, tools:true, reasoning:false }, def.capabilities || {}),
      models: (def.models || []).map(function(m){
        return {
          id: String(m.id),
          label: String(m.label || m.id),
          capabilities: Object.assign({}, def.capabilities, m.capabilities || {})
        };
      })
    };
  }
  function list(){ return Object.keys(byId).map(function(id){ return byId[id]; }); }
  function get(id){ return Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : null; }
  function enabledList(){ return list().filter(function(p){ return p.enabled; }); }
  return { register: register, list: list, get: get, enabledList: enabledList, DEFAULT: MTAI.config.DEFAULT_PROVIDER };
})();
})();
