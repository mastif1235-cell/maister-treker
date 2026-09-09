'use strict';

// Shared DOM shell and tab navigation. Loaded after app.js, before domain adapters.
function formatPhoneInput(e){
  const el = e.target;
  const prevDigits = el.dataset.prevDigitsCount === undefined ? null : Number(el.dataset.prevDigitsCount);
  const valueShrank = el.value.length < Number(el.dataset.prevLength || 0);
  // NEW: раніше тут одразу обрізали до 10 цифр (.slice(0,10)) — якщо
  // вставити номер з кодом країни (+380671234567, 12 цифр), він обрізався
  // до "3806712345" ДО того, як phoneDigitsToMask встигала прибрати "380" —
  // нормалізація коду країни просто не встигала спрацювати. Тепер обрізку
  // й нормалізацію робить сама phoneDigitsToMask (їй передаємо повний
  // рядок цифр), а тут лише рахуємо їх кількість для розпізнавання
  // видалення символу маски (нижче).
  let digits = el.value.replace(/\D/g,'');
  if(valueShrank && prevDigits !== null && digits.length === prevDigits && digits.length > 0){
    digits = digits.slice(0, -1);
  }
  el.value = phoneDigitsToMask(digits);
  el.dataset.prevDigitsCount = el.value.replace(/\D/g,'').length; // NEW: рахуємо ПІСЛЯ нормалізації — інакше 12 "сирих" цифр не збігалися б із 10 у вже нормалізованому значенні
  el.dataset.prevLength = el.value.length;
}
// NEW: викликати після БУДЬ-ЯКОГО програмного встановлення f_phone.value
// (завантаження заявки, відновлення попереднього значення після зміни типу
// тощо) — щоб formatPhoneInput вище одразу знав правильну кількість цифр і
// коректно розпізнавав видалення символу маски з першого ж натискання.
function syncPhoneFieldMaskState(){
  const el = document.getElementById('f_phone');
  el.dataset.prevDigitsCount = el.value.replace(/\D/g,'').length;
  el.dataset.prevLength = el.value.length;
}
function setDateFieldValue(ddmmyyyy){
  document.getElementById('f_date').value = ddmmyyyy || '';
  document.getElementById('f_dateNative').value = ddmmyyyyToIso(ddmmyyyy);
}
function showToast(msg, ms=2200){
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=>{ el.remove(); }, ms);
}

let mtModalCleanup=null;
function openModal(title, bodyHtml, opts={}){
  if(typeof mtModalCleanup==='function')mtModalCleanup(false);
  const root = document.getElementById('modalRoot');
  const overlayClass = String(opts.overlayClass||'').replace(/[^a-zA-Z0-9_-]/g,'');
  const titleId=`mtModalTitle-${Date.now()}`;
  root.innerHTML = `
    <div class="modal-overlay ${overlayClass}" id="modalOverlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
        <div class="modal-head"><h3 id="${titleId}">${escapeHtml(title)}</h3><button type="button" class="modal-close" id="modalCloseBtn" aria-label="Закрити">✕</button></div>
        <div id="modalBody">${bodyHtml}</div>
      </div>
    </div>`;
  const previousFocus=document.activeElement;
  let closed=false;
  const cleanup=(restoreFocus=true)=>{document.removeEventListener('keydown',onKeyDown,true);if(mtModalCleanup===cleanup)mtModalCleanup=null;if(restoreFocus&&previousFocus?.isConnected)previousFocus.focus?.();};
  const doClose=()=>{if(closed)return;closed=true;cleanup();(opts.onClose||closeModal)();};
  const onKeyDown=event=>{
    if(event.key==='Escape'){event.preventDefault();doClose();return;}
    if(event.key!=='Tab')return;
    const dialog=document.querySelector('#modalOverlay [role="dialog"]'),focusable=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])')];
    if(!focusable.length){event.preventDefault();return;}
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  mtModalCleanup=cleanup;document.addEventListener('keydown',onKeyDown,true);
  document.getElementById('modalCloseBtn').onclick = doClose;
  document.getElementById('modalOverlay').addEventListener('click', e=>{ if(e.target.id==='modalOverlay') doClose(); });
  if(opts.onOpen) opts.onOpen(document.getElementById('modalBody'));
  requestAnimationFrame(()=>{const preferred=document.querySelector('#modalBody [data-modal-cancel]')||document.getElementById('modalCloseBtn');preferred?.focus?.();});
}

function openConfirmModal({title,message,confirmLabel='Підтвердити',cancelLabel='Скасувати',danger=false}={}){
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;resolve(value);closeModal();};
    openModal(title||'Підтвердження',`<p class="modal-confirm-message">${escapeHtml(message||'')}</p><div class="row wrap"><button type="button" class="btn ${danger?'btn-danger':'btn-accent'}" data-modal-confirm>${escapeHtml(confirmLabel)}</button><button type="button" class="btn" data-modal-cancel>${escapeHtml(cancelLabel)}</button></div>`,{
      onClose:()=>{if(!settled){settled=true;resolve(false);}closeModal();},
      onOpen:body=>{const confirmBtn=body.querySelector('[data-modal-confirm]'),cancelBtn=body.querySelector('[data-modal-cancel]');confirmBtn.onclick=()=>{if(confirmBtn.disabled)return;confirmBtn.disabled=true;cancelBtn.disabled=true;finish(true);};cancelBtn.onclick=()=>finish(false);}
    });
  });
}

// Єдиний внутрішній Back-stack. Він зберігає лише короткий serializable state
// і callback повторного рендера; DOM, секрети та дані форм у history не кладемо.
const appNavigationStack=[];
function appNavigationState(value={}){try{return JSON.parse(JSON.stringify(value));}catch(_e){return{};}}
function appNavigationPush(key,restore,state={},guard=null){
  appNavigationStack.push({key:String(key||''),restore,state:appNavigationState(state),guard:typeof guard==='function'?guard:null});updateAppBackButton();return true;
}
function appNavigationCanGoBack(){return appNavigationStack.length>0;}
function appNavigationPeek(){return appNavigationStack[appNavigationStack.length-1]||null;}
function appNavigationDrop(key){
  for(let index=appNavigationStack.length-1;index>=0;index--)if(appNavigationStack[index].key===key){appNavigationStack.splice(index,1);break;}
  updateAppBackButton();
}
function appNavigationDropPrefix(prefix){
  for(let index=appNavigationStack.length-1;index>=0;index--)if(appNavigationStack[index].key.startsWith(prefix))appNavigationStack.splice(index,1);
  updateAppBackButton();
}
function appNavigationClear(){appNavigationStack.length=0;updateAppBackButton();}
function appNavigationBack(){
  const entry=appNavigationPeek();if(!entry)return false;
  if(entry.guard&&!entry.guard())return false;
  appNavigationStack.pop();entry.restore?.(entry.state);updateAppBackButton();return true;
}
function appBackButtonHtml(label='Назад'){return `<button type="button" class="btn btn-sm btn-ghost app-back-btn" data-app-back aria-label="${escapeHtml(label)}">← ${escapeHtml(label)}</button>`;}
function updateAppBackButton(){document.getElementById('appBackBtn')?.classList.toggle('hidden',!appNavigationCanGoBack());}

const SCREEN_TITLES = {tickets:'Заявки', calculator:'Калькулятор', shifts:'Зміни', tools:'Інструменти', settings:'Налаштування'};
function switchTab(tab){
  if(tab!=='tools'&&typeof toolsLeaveDiagnostics==='function')toolsLeaveDiagnostics();
  if(tab!=='tools'&&typeof toolsLeaveOfflineSettings==='function')toolsLeaveOfflineSettings();
  if(tab!=='tools'&&typeof toolsStopConnectionCheck==='function')toolsStopConnectionCheck(false);
  // NEW: якщо вкладка вже й так активна — не скидаємо скрол. Це прибирає
  // ефект "улетів на початок форми", який траплявся, якщо щось під час
  // заповнення заявки повторно викликало перемикання на ту саму вкладку.
  const alreadyActive = document.getElementById('screen-'+tab).classList.contains('active');
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+tab).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.getElementById('screenTitle').textContent = SCREEN_TITLES[tab];
  if(tab==='tools' && typeof renderToolsScreen==='function') renderToolsScreen();
  // "Дані" в Налаштуваннях рендеряться один раз при старті застосунку — але
  // кошик змінюється протягом сесії (заявки видаляються з інших екранів),
  // тож оновлюємо саме його щоразу при відкритті вкладки.
  if(tab==='settings') renderDeletedTicketsList();
  if(!alreadyActive) document.querySelector('main.screens').scrollTop = 0;
  updateAppBackButton();
}

function bindTabBar(){
  document.addEventListener('click',event=>{if(event.target.closest('[data-app-back]')){event.preventDefault();appNavigationBack();}});
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const tab = btn.dataset.tab;
      const currentlyOnCalculator = document.getElementById('screen-calculator').classList.contains('active');
      // NEW: раніше умова тут ще й перевіряла editingTicketId===null — тобто
      // попередження про незбережені зміни спрацьовувало ЛИШЕ для НОВОЇ
      // заявки. Якщо редагувати вже існуючу заявку (звичайну чи ☁️
      // відновлену з хмари) і просто тапнути на іншу вкладку — правки
      // тихо губились без жодного попередження (кнопка "Скасувати
      // редагування" своє попередження показує, але перехід через таби
      // йде іншим шляхом і її не зачіпає).
      if(currentlyOnCalculator && tab!=='calculator'){
        syncFormToState();
        if(hasUnsavedChanges()){
          const leave = confirm(editingTicketId ? 'Є незбережені правки заявки. Перейти без збереження?' : 'У калькуляторі є незбережені дані. Перейти без збереження?');
          if(!leave) return;
        }
      }
      if(tab==='calculator' && editingTicketId===null && !calcState.address && !calcState.clientName){
        // якщо форма порожня — підставляємо поточну дату реєстру
        calcState.date = currentTicketDate;
        setDateFieldValue(calcState.date);
      }
      appNavigationClear();
      if(tab==='tools'&&typeof toolsOpenRootFromTab==='function')toolsOpenRootFromTab();
      switchTab(tab);
    });
  });
}
