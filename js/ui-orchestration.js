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

function openModal(title, bodyHtml, opts={}){
  const root = document.getElementById('modalRoot');
  const overlayClass = String(opts.overlayClass||'').replace(/[^a-zA-Z0-9_-]/g,'');
  root.innerHTML = `
    <div class="modal-overlay ${overlayClass}" id="modalOverlay">
      <div class="modal">
        <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="modal-close" id="modalCloseBtn">✕</button></div>
        <div id="modalBody">${bodyHtml}</div>
      </div>
    </div>`;
  const doClose = opts.onClose || closeModal; // NEW: дозволяє викликачу повернутись до свого контексту (напр. профілю) замість повного закриття
  document.getElementById('modalCloseBtn').onclick = doClose;
  document.getElementById('modalOverlay').addEventListener('click', e=>{ if(e.target.id==='modalOverlay') doClose(); });
  if(opts.onOpen) opts.onOpen(document.getElementById('modalBody'));
}

const SCREEN_TITLES = {tickets:'Заявки', calculator:'Калькулятор', shifts:'Зміни', tools:'Інструменти', settings:'Налаштування'};
function switchTab(tab){
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
}

function bindTabBar(){
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
      switchTab(tab);
    });
  });
}
