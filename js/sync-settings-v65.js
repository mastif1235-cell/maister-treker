/* Maister Tracker — sync settings migration for architecture-cleanup.
 * Keeps the existing DOM ids until the UI markup cleanup, but changes their
 * meaning to the v2 HMAC protocol. The legacy plain syncSecret is never
 * promoted automatically to an HMAC key.
 */
(() => {
  'use strict';

  const MIN_HMAC_SECRET_LENGTH = 32;

  function normalizeUrl(value){
    const raw = String(value || '').trim();
    if(!raw) return '';
    try{
      const url = new URL(raw);
      if(url.protocol !== 'https:') return '';
      url.search = '';
      url.hash = '';
      return url.href.replace(/\/$/, '');
    }catch(_){
      return '';
    }
  }

  function ensureModel(){
    if(typeof settings === 'undefined' || !settings) return false;
    if(typeof settings.syncHmacSecret !== 'string') settings.syncHmacSecret = '';
    settings.syncHmacSecret = String(settings.syncHmacSecret || '').trim();
    settings.scriptUrl = normalizeUrl(settings.scriptUrl);
    settings.shiftsScriptUrl = '';
    return true;
  }

  ensureModel();

  const baseRender = window.renderSettingsScreen;
  if(typeof baseRender === 'function'){
    window.renderSettingsScreen = function(){
      ensureModel();
      const legacySecret = settings.syncSecret;
      settings.syncSecret = settings.syncHmacSecret;
      try{ baseRender.apply(this, arguments); }
      finally{ settings.syncSecret = legacySecret; }

      const secretInput = document.getElementById('syncSecretInput');
      if(secretInput){
        secretInput.value = settings.syncHmacSecret || '';
        secretInput.type = 'password';
        secretInput.autocomplete = 'new-password';
        secretInput.placeholder = 'мінімум 32 випадкові символи';
        const field = secretInput.closest('.field');
        const label = field && field.querySelector('label');
        if(label) label.textContent = 'HMAC-ключ синхронізації';
      }
      const urlInput = document.getElementById('scriptUrlInput');
      if(urlInput){
        const field = urlInput.closest('.field');
        const label = field && field.querySelector('label');
        if(label) label.textContent = 'Єдиний URL Apps Script (заявки + зміни)';
      }
      const shiftsInput = document.getElementById('shiftsScriptUrlInput');
      if(shiftsInput){
        const field = shiftsInput.closest('.field');
        if(field) field.classList.add('hidden');
      }
    };
  }

  const baseBind = window.bindSettingsScreen;
  if(typeof baseBind === 'function'){
    window.bindSettingsScreen = function(){
      baseBind.apply(this, arguments);
      ensureModel();

      const oldSecret = document.getElementById('syncSecretInput');
      if(oldSecret){
        const input = oldSecret.cloneNode(true);
        oldSecret.replaceWith(input);
        input.value = settings.syncHmacSecret || '';
        input.type = 'password';
        input.autocomplete = 'new-password';
        input.addEventListener('input', e => {
          settings.syncHmacSecret = String(e.target.value || '').trim();
          settings.syncSecret = '';
          saveSettings();
        });
        input.addEventListener('blur', () => {
          const value = String(settings.syncHmacSecret || '');
          if(value && value.length < MIN_HMAC_SECRET_LENGTH){
            showToast('HMAC-ключ має містити щонайменше 32 символи');
          }
        });
      }

      const oldUrl = document.getElementById('scriptUrlInput');
      if(oldUrl){
        const input = oldUrl.cloneNode(true);
        oldUrl.replaceWith(input);
        input.value = settings.scriptUrl || '';
        input.addEventListener('change', e => {
          const raw = String(e.target.value || '').trim();
          const clean = normalizeUrl(raw);
          if(raw && !clean){
            showToast('Потрібен коректний HTTPS URL Apps Script');
            e.target.value = settings.scriptUrl || '';
            return;
          }
          settings.scriptUrl = clean;
          settings.shiftsScriptUrl = '';
          e.target.value = clean;
          saveSettings();
        });
      }

      const shiftsInput = document.getElementById('shiftsScriptUrlInput');
      if(shiftsInput){
        const field = shiftsInput.closest('.field');
        if(field) field.classList.add('hidden');
      }
    };
  }

  window.MaisterSyncSettings = Object.freeze({
    minSecretLength: MIN_HMAC_SECRET_LENGTH,
    normalizeUrl,
    ready(){
      return ensureModel() && !!settings.scriptUrl && settings.syncHmacSecret.length >= MIN_HMAC_SECRET_LENGTH;
    }
  });
})();
