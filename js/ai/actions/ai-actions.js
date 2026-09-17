/* AI: action layer (арматура майбутнього WRITE-режиму). УСІ write-дії
   вимкнені і/backend READ-ONLY. Жодна дія не виконується без явного
   підтвердження користувача (confirmFlow) — і поки взагалі жодна не
   виконується: enabled:false у всіх. Єдина реальна дія зараз —
   openTicket(id): read-only навігація до наявної заявки в застосунку. */
(function(){
'use strict';
const MTAI = (typeof globalThis !== 'undefined' ? globalThis : window).MTAI;
MTAI.actions = (function(){
  const registry = Object.create(null); // id -> {id,label,kind,enabled,confirmText,run}

  function register(def){
    registry[def.id] = {
      id: def.id,
      label: String(def.label || def.id),
      kind: def.kind === 'write' ? 'write' : 'read', // write-дії вимкнені глобально
      enabled: def.kind === 'write' ? false : (def.enabled !== false),
      confirmText: String(def.confirmText || ''),
      run: def.run || null
    };
  }
  function list(){ return Object.keys(registry).map(function(id){ return registry[id]; }); }
  function isEnabled(id){ const a = registry[id]; return !!(a && a.enabled); }
  /* Виконання write-дії: гардована подвійною перевіркою + confirm-колбеком.
     Поки що завжди відмовляє (WRITE tools на backend відсутні). */
  async function execute(id, args, confirmUi){
    const action = registry[id];
    if(!action) return { ok:false, reason:'unknown_action' };
    if(action.kind === 'write' || !action.enabled){
      return { ok:false, reason:'write_disabled', message:'WRITE-дії зараз вимкнені (READ-ONLY етап).' };
    }
    if(action.confirmText && typeof confirmUi !== 'function'){
      return { ok:false, reason:'confirmation_required' };
    }
    if(action.confirmText && !(await confirmUi(action.confirmText))) return { ok:false, reason:'cancelled' };
    try{ return await action.run(args); }
    catch(_err){ return { ok:false, reason:'failed' }; }
  }
  /* READ-ONLY навігація: відкрити наявну заявку у звичайному редакторі
     застосунку (без створення/змін). Feature-detect глобальних функцій. */
  function openTicket(id){
    const clean = String(id || '').replace(/[^0-9a-zа-яіїєг_-]/gi, '');
    if(!clean) return false;
    /* READ-ONLY навігація: спочатку згорнути власний AI overlay, щоб панель
       чата не перекривала екран заявки (панель лише ховається — чат і
       налаштування зберігаються). */
    try{
      const doc = typeof document !== 'undefined' ? document : null;
      const panel = doc && doc.getElementById('aiChatPanel');
      if(panel) panel.style.display = 'none';
      const blocked = doc && doc.getElementById('aiBlockedPanel');
      if(blocked) blocked.style.display = 'none';
    }catch(_overlayErr){}
    try{
      if(typeof tickets !== 'undefined' && Array.isArray(tickets) && tickets.length &&
         !tickets.some(function(t){ return String(t.id) === clean; })){
        if(typeof showToast === 'function') showToast('Заявку ' + clean + ' не знайдено на пристрої');
        return false;
      }
      if(typeof openTicketEditorFromList === 'function'){ openTicketEditorFromList(clean); return true; }
    }catch(_e){}
    if(typeof showToast === 'function') showToast('Відкриття заявки недоступне з цього екрана');
    return false;
  }
  return { register: register, list: list, isEnabled: isEnabled, execute: execute, openTicket: openTicket };
})();
})();
