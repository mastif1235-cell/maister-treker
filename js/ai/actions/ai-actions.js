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
  /* Порівняння id: точне або числово-нормалізоване ('0871' === '871',
     871 === '871') — MCP/GAS і локальна база можуть відрізнятися нулями. */
  function sameId(a, b){
    const A = String(a == null ? '' : a).trim();
    const B = String(b == null ? '' : b).trim();
    if(A === B) return true;
    const na = A.replace(/^0+(?=[0-9])/, '');
    const nb = B.replace(/^0+(?=[0-9])/, '');
    return /^[0-9]+$/.test(na) && /^[0-9]+$/.test(nb) && na === nb;
  }
  function findTicketIn(list, id){
    if(!Array.isArray(list)) return null;
    for(const t of list){
      if(t && sameId(t.id, id)) return t;
    }
    return null;
  }

  /* READ-ONLY навігація: відкрити заявку у ЗВИЧАЙНОМУ редакторі застосунку
     (без створення/змін). Пошук: 1) масив tickets у пам'яті, 2) fallback —
     локальна IndexedDB (ticketsDbRead): на свіжому домені preview масив
     може бути порожній, хоча заявка є в локальній базі. Якщо заявки НЕМАЄ
     локально — ЧЕСНЕ видиме повідомлення, overlay лишається відкритим
     (жодних тихих «повернень в Інструменти»). Overlay згортається ЛИШЕ
     після успішного знаходження заявки. */
  async function openTicket(id){
    const clean = String(id || '').replace(/[^0-9a-zа-яіїєг_-]/gi, '');
    if(!clean) return false;
    let ticket = findTicketIn(typeof tickets !== 'undefined' ? tickets : null, clean);
    if(!ticket && typeof ticketsDbRead === 'function'){
      try{
        const read = await ticketsDbRead();
        const stored = read && read.status === 'ok' ? read.value : null;
        ticket = findTicketIn(stored, clean);
        if(ticket && typeof tickets !== 'undefined' && Array.isArray(tickets) && !findTicketIn(tickets, clean)){
          tickets.push(ticket); // self-heal: гідратуємо заявку в пам'ять для editor
        }
      }catch(_idbErr){}
    }
    if(!ticket){
      if(typeof showToast === 'function') showToast('Заявку ' + clean + ' не знайдено на пристрої — синхронізуйте заявки і спробуйте ще раз');
      try{
        const st = typeof document !== 'undefined' && document.getElementById('aiVoiceStatus');
        if(st) st.textContent = '⚠️ Заявку №' + clean + ' не знайдено на цьому пристрої. AI знайшов її на backend — виконайте синхронізацію заявок у застосунку, щоб відкривати знайдене.';
      }catch(_stErr){}
      return false;
    }
    /* Успіх: згорнути власний AI overlay, щоб панель не перекривала
       екран заявки (чат лише ховається — історія зберігається). */
    try{
      const doc = typeof document !== 'undefined' ? document : null;
      const panel = doc && doc.getElementById('aiChatPanel');
      if(panel) panel.style.display = 'none';
      const blocked = doc && doc.getElementById('aiBlockedPanel');
      if(blocked) blocked.style.display = 'none';
    }catch(_overlayErr){}
    try{
      if(typeof openTicketEditorFromList === 'function'){ openTicketEditorFromList(String(ticket.id)); return true; }
    }catch(_e){}
    if(typeof showToast === 'function') showToast('Відкриття заявки недоступне з цього екрана');
    return false;
  }
  return { register: register, list: list, isEnabled: isEnabled, execute: execute, openTicket: openTicket };
})();
})();
