/* AI: action layer (арматура майбутнього WRITE-режиму). УСІ write-дії
   вимкнені і backend READ-ONLY. Жодна дія не виконується без явного
   підтвердження користувача (confirmFlow) — і поки взагалі жодна не
   виконується: enabled:false у всіх.

   READ-ONLY навігаційні дії:
   - openTicket(id): перехід до наявного профілю абонента (goToTicketProfile).
     НЕ робить fallback до редактора/калькулятора — якщо структурованої
     адреси немає, повідомляє про це й залишає картку в чаті.
   - showOnMap(id): відкриває наявну карту застосунку та фокусує точку
     за збереженими координатами.
   Обидва переходи зберігають стек навігації ('ai-return'), тому натискання
   «Назад» повертає користувача в AI з повною історією. */
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

  /* READ-ONLY навігація: відкрити профіль заявки через наявний перегляд
     goToTicketProfile. Пошук: 1) tickets у пам'яті, 2) fallback IndexedDB.
     Критично: якщо структурованої адреси немає — НЕ скидати в калькулятор,
     а чесно повідомити користувача й залишити картку в AI. */
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
          tickets.push(ticket); // self-heal
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

    const city = String(ticket.city || '').trim();
    const street = String(ticket.street || '').trim();
    if(!city || !street){
      // ТЗ-1: НІЯКОГО fallback у редактор калькулятора!
      if(typeof showToast === 'function'){
        showToast('У цієї заявки немає структурованої адреси — відкриття профілю недоступне. Дані відображено в картці AI.');
      }
      return false;
    }

    /* Успіх: пушимо кадр повернення в AI на стек навігації */
    if(typeof appNavigationPush === 'function'){
      appNavigationPush('ai-return', function(){
        if(typeof MTAI !== 'undefined' && MTAI.ui && typeof MTAI.ui.restoreFromNavigation === 'function'){
          MTAI.ui.restoreFromNavigation();
        }
      });
    }

    try{
      const doc = typeof document !== 'undefined' ? document : null;
      const panel = doc && doc.getElementById('aiChatPanel');
      if(panel) panel.style.display = 'none';
      const blocked = doc && doc.getElementById('aiBlockedPanel');
      if(blocked) blocked.style.display = 'none';
    }catch(_overlayErr){}

    try{
      if(typeof goToTicketProfile === 'function'){
        goToTicketProfile(String(ticket.id));
        return true;
      }
    }catch(_e){}

    if(typeof showToast === 'function') showToast('Відкриття профілю недоступне з цього екрана');
    return false;
  }

  /* READ-ONLY навігація на карту застосунку */
  async function showOnMap(id){
    const clean = String(id || '').replace(/[^0-9a-zа-яіїєг_-]/gi, '');
    if(!clean) return false;
    let ticket = findTicketIn(typeof tickets !== 'undefined' ? tickets : null, clean);
    if(!ticket && typeof ticketsDbRead === 'function'){
      try{
        const read = await ticketsDbRead();
        const stored = read && read.status === 'ok' ? read.value : null;
        ticket = findTicketIn(stored, clean);
        if(ticket && typeof tickets !== 'undefined' && Array.isArray(tickets) && !findTicketIn(tickets, clean)){
          tickets.push(ticket);
        }
      }catch(_idbErr){}
    }
    if(!ticket){
      if(typeof showToast === 'function') showToast('Заявку ' + clean + ' не знайдено на пристрої');
      return false;
    }

    let coords = null;
    if(typeof MTToolsCore !== 'undefined'){
      coords = MTToolsCore.explicitCoordinates(ticket) || MTToolsCore.parseCoordinates(ticket.geoLink);
    }
    if(!coords){
      if(typeof showToast === 'function') showToast('У цієї заявки немає збережених координат на карті');
      return false;
    }

    if(typeof appNavigationPush === 'function'){
      appNavigationPush('ai-return', function(){
        if(typeof MTAI !== 'undefined' && MTAI.ui && typeof MTAI.ui.restoreFromNavigation === 'function'){
          MTAI.ui.restoreFromNavigation();
        }
      });
    }

    try{
      const doc = typeof document !== 'undefined' ? document : null;
      const panel = doc && doc.getElementById('aiChatPanel');
      if(panel) panel.style.display = 'none';
      const blocked = doc && doc.getElementById('aiBlockedPanel');
      if(blocked) blocked.style.display = 'none';
    }catch(_overlayErr){}

    try{
      if(typeof switchTab === 'function') switchTab('tools');
      if(typeof renderToolsScreen === 'function') renderToolsScreen('map');
      if(typeof requestAnimationFrame === 'function'){
        requestAnimationFrame(function(){
          requestAnimationFrame(function(){
            if(typeof MTToolsMap !== 'undefined' && typeof MTToolsMap.focusPoint === 'function'){
              MTToolsMap.focusPoint(coords, 18);
            }
            const mapEl = typeof document !== 'undefined' && document.getElementById('toolsLeafletMap');
            if(mapEl && typeof mapEl.scrollIntoView === 'function'){
              mapEl.scrollIntoView({behavior:'smooth', block:'center'});
            }
          });
        });
      }
      return true;
    }catch(_e){}

    if(typeof showToast === 'function') showToast('Відкриття карти недоступне');
    return false;
  }

  return { register: register, list: list, isEnabled: isEnabled, execute: execute, openTicket: openTicket, showOnMap: showOnMap };
})();
})();
