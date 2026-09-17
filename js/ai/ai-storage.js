/* AI: зберігання налаштувань. Звичайні поля — у стандартному об'єкті
   settings застосунку (saveSettings()), bearer-токен — у наявному
   зашифрованому vault (js/settings-secrets-vault.js, AES-GCM). Жодного
   другого storage і жодних provider API keys у PWA. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.storage = (function(){
  function ensure(){
    if(!settings.ai || typeof settings.ai !== 'object'){
      settings.ai = {
        enabled:false,
        provider:MTAI.config.DEFAULT_PROVIDER,
        model:MTAI.config.DEFAULT_MODEL,
        backendUrl:MTAI.config.DEFAULT_BACKEND
      };
    }
    const ai = settings.ai;
    if(typeof ai.enabled !== 'boolean') ai.enabled = false;
    if(typeof ai.provider !== 'string' || !ai.provider) ai.provider = MTAI.config.DEFAULT_PROVIDER;
    if(typeof ai.model !== 'string' || !ai.model) ai.model = MTAI.config.DEFAULT_MODEL;
    if(typeof ai.backendUrl !== 'string') ai.backendUrl = MTAI.config.DEFAULT_BACKEND;
    ai.backendUrl = ai.backendUrl.trim().replace(/\/+$/, '');
    if(typeof settings.aiBearerToken !== 'string') settings.aiBearerToken = '';
    return ai;
  }
  function get(){ return ensure(); }
  function update(patch){
    const ai = ensure();
    Object.keys(patch || {}).forEach(function(key){
      if(key === 'enabled') ai.enabled = patch.enabled === true;
      else if(key === 'provider' && typeof patch.provider === 'string') ai.provider = patch.provider;
      else if(key === 'model' && typeof patch.model === 'string') ai.model = patch.model;
      else if(key === 'backendUrl' && typeof patch.backendUrl === 'string') ai.backendUrl = patch.backendUrl.trim().replace(/\/+$/, '');
    });
    saveSettings();
    return ai;
  }
  function setToken(value){ ensure(); settings.aiBearerToken = String(value == null ? '' : value).trim(); saveSettings(); }
  function hasToken(){ ensure(); return !!settings.aiBearerToken; }
  /* Bearer для header — тільки середня частина name:token:scope (якщо
     вставлено повний рядок). Значення ніколи не логується і не показується. */
  function bearer(){
    ensure();
    const parts = settings.aiBearerToken.split(':');
    return parts.length >= 3 ? parts[parts.length - 2] : settings.aiBearerToken;
  }
  function isAllowedBackend(url){
    return MTAI.config.ALLOWED_BACKENDS.indexOf(String(url || '').trim().replace(/\/+$/, '')) !== -1;
  }
  function isReady(){
    const ai = ensure();
    return !!(ai.enabled && ai.backendUrl && isAllowedBackend(ai.backendUrl) && settings.aiBearerToken);
  }
  return { ensure: ensure, get: get, update: update, setToken: setToken, hasToken: hasToken, bearer: bearer, isAllowedBackend: isAllowedBackend, isReady: isReady };
})();
})();
