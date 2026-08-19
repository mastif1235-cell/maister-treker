/* Maister Tracker — sync settings migration for architecture-cleanup. */
(() => {
  'use strict';
  const MIN_HMAC_SECRET_LENGTH = 32;

  function normalizeUrl(value){
    const raw=String(value||'').trim();
    if(!raw)return'';
    try{const url=new URL(raw);if(url.protocol!=='https:')return'';url.search='';url.hash='';return url.href.replace(/\/$/,'');}catch(_){return'';}
  }
  function ensureModel(){
    if(typeof settings==='undefined'||!settings)return false;
    if(typeof settings.syncHmacSecret!=='string')settings.syncHmacSecret='';
    settings.syncHmacSecret=String(settings.syncHmacSecret||'').trim();
    settings.scriptUrl=normalizeUrl(settings.scriptUrl);
    settings.shiftsScriptUrl='';
    return true;
  }
  function decorate(){
    if(!ensureModel())return;
    const secret=document.getElementById('syncSecretInput');
    if(secret){secret.value=settings.syncHmacSecret||'';secret.type='password';secret.autocomplete='new-password';secret.placeholder='мінімум 32 випадкові символи';const f=secret.closest('.field'),l=f&&f.querySelector('label');if(l)l.textContent='HMAC-ключ синхронізації';}
    const url=document.getElementById('scriptUrlInput');
    if(url){url.value=settings.scriptUrl||'';const f=url.closest('.field'),l=f&&f.querySelector('label');if(l)l.textContent='Єдиний URL Apps Script (заявки + зміни)';}
    const shifts=document.getElementById('shiftsScriptUrlInput');if(shifts){const f=shifts.closest('.field');if(f)f.classList.add('hidden');}
  }
  function installInputs(){
    if(!ensureModel())return;
    let old=document.getElementById('syncSecretInput');
    if(old&&!old.dataset.hmacOwner){const input=old.cloneNode(true);old.replaceWith(input);input.dataset.hmacOwner='1';input.value=settings.syncHmacSecret||'';input.type='password';input.autocomplete='new-password';input.addEventListener('input',e=>{settings.syncHmacSecret=String(e.target.value||'').trim();settings.syncSecret='';saveSettings();});input.addEventListener('blur',()=>{const v=String(settings.syncHmacSecret||'');if(v&&v.length<MIN_HMAC_SECRET_LENGTH)showToast('HMAC-ключ має містити щонайменше 32 символи');});}
    old=document.getElementById('scriptUrlInput');
    if(old&&!old.dataset.hmacOwner){const input=old.cloneNode(true);old.replaceWith(input);input.dataset.hmacOwner='1';input.value=settings.scriptUrl||'';input.addEventListener('change',e=>{const raw=String(e.target.value||'').trim(),clean=normalizeUrl(raw);if(raw&&!clean){showToast('Потрібен коректний HTTPS URL Apps Script');e.target.value=settings.scriptUrl||'';return;}settings.scriptUrl=clean;settings.shiftsScriptUrl='';e.target.value=clean;saveSettings();});}
    decorate();
  }

  ensureModel();
  const baseRender=window.renderSettingsScreen;
  if(typeof baseRender==='function')window.renderSettingsScreen=function(){ensureModel();const legacy=settings.syncSecret;settings.syncSecret=settings.syncHmacSecret;try{baseRender.apply(this,arguments);}finally{settings.syncSecret=legacy;}decorate();};
  const baseBind=window.bindSettingsScreen;
  if(typeof baseBind==='function')window.bindSettingsScreen=function(){baseBind.apply(this,arguments);installInputs();};

  // Covers both possible parser orderings: if app init already bound the old
  // listeners, replace those nodes now; otherwise wrapped bindSettingsScreen
  // installs ownership when init reaches the settings screen.
  installInputs();

  window.MaisterSyncSettings=Object.freeze({minSecretLength:MIN_HMAC_SECRET_LENGTH,normalizeUrl,ready(){return ensureModel()&&!!settings.scriptUrl&&settings.syncHmacSecret.length>=MIN_HMAC_SECRET_LENGTH;}});
})();
