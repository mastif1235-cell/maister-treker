'use strict';

// Ticket address navigation and naryad workflows. Loaded after app.js.
function findNaryadMatches(rawText){
  const phoneKeys = extractPhoneCandidatesFromText(rawText);
  const naryadTokens = new Set(extractAddressTokens(rawText));
  // NEW: номер будинку типу "10 А" в тексті наряду розпадається на два
  // окремих слова ("10" і "а"), а в самій заявці зберігається як один
  // рядок — тому окремо будуємо "сирі" слова БЕЗ фільтра довжини (інакше
  // самотня літера "а" губиться) і додаємо ще й пари сусідніх слів, злиті
  // без пробілу, у порядку появи в тексті — щоб зловити обидва записи.
  const rawWords = String(rawText||'').toLowerCase().replace(/[.,№\/]/g,' ').split(/\s+/).filter(Boolean);
  const naryadHouseCandidates = new Set(rawWords);
  for(let i=0;i<rawWords.length-1;i++){ naryadHouseCandidates.add(rawWords[i]+rawWords[i+1]); }
  const results = [];
  tickets.forEach(t=>{
    const reasons = [];
    const tPhoneKey = normalizePhoneKey(t.phone);
    if(tPhoneKey && phoneKeys.includes(tPhoneKey)) reasons.push({label:'збіг за телефоном', strong:true});
    // NEW: збіг рахуємо лише за ВУЛИЦЕЮ + БУДИНКОМ, а не за містом/селом —
    // назва населеного пункту сама по собі нічого не каже (в одному селі можуть
    // бути десятки заявок на різних вулицях), тож раніше через неї спрацьовував
    // "можливий збіг" навіть для геть різних адрес в тому ж селі.
    const streetTokens = extractAddressTokens(t.street);
    const houseToken = t.house ? String(t.house).toLowerCase().replace(/\s+/g,'').trim() : '';
    // NEW: раніше вимагався збіг УСІХ слів вулиці — але диспетчери часто
    // скорочують багатослівні назви (напр. "Тараса Шевченка" пишуть просто
    // "Шевченка"). Тепер достатньо збігу останнього слова — в українських
    // назвах саме воно зазвичай прізвище, і саме так їх найчастіше скорочують.
    const streetMatch = streetTokens.length>0 && naryadTokens.has(streetTokens[streetTokens.length-1]);
    const houseMatch = houseToken && naryadHouseCandidates.has(houseToken);
    if(streetMatch && houseMatch) reasons.push({label:'можливий збіг за адресою', strong:false});
    if(reasons.length) results.push({ticket:t, reasons});
  });
  // спочатку надійні (телефон), потім лише "можливі"; в межах групи — новіші вище
  results.sort((a,b)=>{
    const aStrong = a.reasons.some(r=>r.strong) ? 1 : 0;
    const bStrong = b.reasons.some(r=>r.strong) ? 1 : 0;
    if(aStrong !== bStrong) return bStrong - aStrong;
    return ticketSortKey(b.ticket) - ticketSortKey(a.ticket); // NEW: числовий ключ замість текстового порівняння дати — див. коментар в addrNavSearchResultsHtml
  });
  return results;
}

function closeModal(){ if(typeof mtModalCleanup==='function')mtModalCleanup();document.getElementById('modalRoot').innerHTML=''; }
// NEW: "🔍 Повна заявка" на картці профілю абонента (де показано лише
// стислий перелік робіт) — просто показує оригінальний повний текст заявки
// для читання, без переходу в режим редагування.
function showFullTicketText(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  openModal(`${t.type||'Заявка'} · ${t.date||''} ${t.time||''}`, `<div style="white-space:pre-wrap; font-size:14px; line-height:1.5;">${escapeHtml(t.content || '(немає тексту)')}</div>`, {onClose: renderAddressNav});
}

// NEW: "Перевірити наряд" — вставляєш сирий текст від диспетчера (як у Telegram),
// показує, чи вже була заявка по цьому телефону/адресі. Не блокує нічого і
// нічого не створює сама — це просто підказка перед тим, як заводити нову заявку.
// NEW: перехід на "профіль абонента" (адреса з картками), а не одразу в саму
// заявку — так і з результатів пошуку, і з перевірки наряду. Якщо в заявки
// взагалі нема структурованої адреси (місто+вулиця), навігатором туди не
// потрапити — тоді відкриваємо саму заявку як запасний варіант.
function openAddressForTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  const city = (t.city||'').trim();
  const street = (t.street||'').trim();
  if(!city || !street){ closeModal(); editTicket(id); return; }
  const house = (t.house||'').trim() || '(без номера)';
  const apartment = ticketApartmentKey(t); // NEW: без цього фільтр на рівні 'tickets' не знаходив жодної заявки
  addrNavSearchQuery = '';
  addrNavState = {level:'tickets', city, street, house, apartment};
  renderAddressNav();
}
// NEW: черга "сирих" нарядів від диспетчера (окремо від "Перевірити наряд" —
// той інструмент для одноразової перевірки збігів, а це — список того, що
// диспетчер скинув, а ти ще не встиг доїхати й перетворити на заявку).
// Кожен наряд прив'язаний до конкретної дати виконання (не дати додавання!)
// — диспетчер каже "це на післязавтра", ти одразу ставиш післязавтра, і коли
// доходить той день — наряд сам там і чекає.
// Підпис кнопки під датою — кількість ще не виконаних нарядів САМЕ на дату,
// яка зараз переглядається в календарі заявок (оновлюється разом з нею).
function updateNaryadQueueBtn(){
  const btn = document.getElementById('naryadQueueBtn');
  if(!btn) return;
  const pending = naryadQueue.filter(n=>!n.done && naryadItemDate(n, formatDate)===currentTicketDate).length;
  btn.textContent = pending ? `📋 Наряди на цю дату (${pending})` : '📋 Наряди від диспетчера';
}

// Головний список — з навігацією по днях (як і на екрані "Заявки"), щоб
// можна було глянути наперед чи назад, не виходячи звідси.
function showNaryadQueue(date){
  let viewDate = date || currentTicketDate;
  const bodyHtml = `
    <div class="row" style="gap:6px; align-items:center; margin-bottom:12px;">
      <button type="button" class="btn btn-icon" id="naryadQueuePrevDayBtn">‹</button>
      <div style="flex:1; text-align:center; font-weight:700;" id="naryadQueueDateLabel">${escapeHtml(viewDate)}</div>
      <button type="button" class="btn btn-icon" id="naryadQueueNextDayBtn">›</button>
    </div>
    <button type="button" class="btn btn-block" id="naryadQueueAddBtn">➕ Додати наряд</button>
    <div id="naryadQueueListArea" style="margin-top:14px;">${naryadQueueListHtml(naryadQueue, viewDate, tickets, formatDate, escapeHtml)}</div>`;
  openModal('Наряди від диспетчера', bodyHtml, {onOpen: (rootEl)=>{
    const refresh = ()=>{
      document.getElementById('naryadQueueDateLabel').textContent = viewDate;
      document.getElementById('naryadQueueListArea').innerHTML = naryadQueueListHtml(naryadQueue, viewDate, tickets, formatDate, escapeHtml);
    };
    document.getElementById('naryadQueuePrevDayBtn').addEventListener('click', ()=>{ viewDate = shiftDate(viewDate,-1); refresh(); });
    document.getElementById('naryadQueueNextDayBtn').addEventListener('click', ()=>{ viewDate = shiftDate(viewDate,1); refresh(); });
    // NEW: поле вводу — окрема "на весь екран" модалка (див. showAddNaryadModal
    // нижче), а не тісний textarea поруч зі списком
    document.getElementById('naryadQueueAddBtn').addEventListener('click', ()=> showAddNaryadModal(viewDate));
    rootEl.addEventListener('click', e=>{
      const editTicketBtn = e.target.closest('.naryad-queue-edit-ticket-btn');
      if(editTicketBtn){
        // Наряд уже пов'язаний зі збереженою заявкою: відкриваємо саме її
        // стандартним шляхом editTicket, без створення другої форми чи нового ID.
        closeModal();
        editTicket(editTicketBtn.dataset.ticketId);
        return;
      }
      const editNaryadBtn = e.target.closest('.naryad-queue-edit-btn');
      if(editNaryadBtn){
        // Редагуємо саме вихідний наряд у черзі, не створюючи нового запису.
        showAddNaryadModal(viewDate, editNaryadBtn.dataset.id);
        return;
      }
      const doneBtn = e.target.closest('.naryad-queue-done-btn');
      if(doneBtn){
        const n = naryadQueue.find(x=>String(x.id)===doneBtn.dataset.id);
        if(n){ n.done = !n.done; saveNaryadQueue(); refresh(); updateNaryadQueueBtn(); }
        return;
      }
      const delBtn = e.target.closest('.naryad-queue-delete-btn');
      if(delBtn){
        if(!confirm('Прибрати цей наряд з черги?')) return;
        naryadQueue = naryadQueue.filter(x=>String(x.id)!==delBtn.dataset.id);
        saveNaryadQueue();
        refresh();
        updateNaryadQueueBtn();
        return;
      }
      const rescheduleBtn = e.target.closest('.naryad-queue-reschedule-btn');
      if(rescheduleBtn){ showRescheduleNaryadModal(rescheduleBtn.dataset.id); return; }
      const createBtn = e.target.closest('.naryad-queue-create-btn');
      if(createBtn){
        const n = naryadQueue.find(x=>String(x.id)===createBtn.dataset.id);
        if(!n) return;
        // Позначку "виконано" ставимо після збереження заявки, а не тут:
        // форму можна закрити без збереження, і тоді наряд має лишитися в черзі.
        const prefill = {masterNote: n.text};
        const phoneMatch = extractPhoneFromText(n.text);
        if(phoneMatch) prefill.phone = phoneDigitsToMask(phoneMatch);
        showTicketTypePicker(type=> startNewTicketFlow(type, prefill, null, n.id), ()=> showNaryadQueue(viewDate));
      }
    });
  }});
}
// NEW: окрема модалка лише для вставки тексту наряду — поле вводу займає
// майже весь екран (замість тісного блоку поряд зі списком), плюс швидкий
// вибір дати виконання (Сьогодні/Завтра/Післязавтра або довільна дата).
function showAddNaryadModal(defaultDate, editingNaryadId){
  const editingNaryad = editingNaryadId
    ? naryadQueue.find(n=>String(n.id)===String(editingNaryadId))
    : null;
  if(editingNaryadId && !editingNaryad) return;
  const today = formatDate(new Date());
  const initialDate = editingNaryad ? naryadItemDate(editingNaryad, formatDate) : (defaultDate || today);
  const isEditing = !!editingNaryad;
  const bodyHtml = `
    <textarea id="addNaryadInput" class="naryad-editor-textarea" placeholder="Встав сюди текст наряду від диспетчера…">${escapeHtml(editingNaryad ? editingNaryad.text : '')}</textarea>
    <div class="row" style="gap:6px; margin-top:10px;">
      <button type="button" class="btn btn-sm addNaryadDateBtn" data-date="${today}" style="flex:1;">Сьогодні</button>
      <button type="button" class="btn btn-sm addNaryadDateBtn" data-date="${shiftDate(today,1)}" style="flex:1;">Завтра</button>
      <button type="button" class="btn btn-sm addNaryadDateBtn" data-date="${shiftDate(today,2)}" style="flex:1;">Післязавтра</button>
    </div>
    <div class="field" style="margin-top:10px;">
      <label>Дата виконання</label>
      <input type="date" id="addNaryadDateInput" value="${ddmmyyyyToIso(initialDate)}">
    </div>
    <button type="button" class="btn btn-block btn-accent" id="addNaryadSaveBtn" style="margin-top:12px;">${isEditing ? '✅ Зберегти зміни' : '✅ Додати в чергу'}</button>`;
  openModal(isEditing ? 'Редагувати наряд' : 'Новий наряд', bodyHtml, {overlayClass:'naryad-editor-overlay',onClose: ()=> showNaryadQueue(initialDate), onOpen: ()=>{
    document.getElementById('addNaryadInput').focus();
    document.querySelectorAll('.addNaryadDateBtn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ document.getElementById('addNaryadDateInput').value = ddmmyyyyToIso(btn.dataset.date); });
    });
    document.getElementById('addNaryadSaveBtn').addEventListener('click', ()=>{
      const text = document.getElementById('addNaryadInput').value.trim();
      if(!text){ showToast('Встав текст наряду'); return; }
      const chosenDate = isoToDdmmyyyy(document.getElementById('addNaryadDateInput').value) || initialDate;
      if(editingNaryad){
        // Зберігаємо той самий об'єкт: ID, createdAt, done і ticketId не
        // змінюються. Оновлюються лише поля, доступні у формі створення.
        editingNaryad.text = text;
        editingNaryad.date = chosenDate;
        saveNaryadQueue();
        updateNaryadQueueBtn();
        showToast('Наряд оновлено');
        showNaryadQueue(chosenDate);
        return;
      }
      const now = new Date();
      naryadQueue.push({id: Date.now(), text, date: chosenDate, createdAt: `${formatDate(now)} ${formatTime(now)}`, done: false});
      saveNaryadQueue();
      updateNaryadQueueBtn();
      // NEW: одразу перевіряємо, чи це вже знайомий абонент (за телефоном
      // чи адресою з тексту наряду) — наряд у будь-якому разі вже додано,
      // це лише підказка з можливістю одразу перейти в профіль і глянути
      // попередні заявки, перш ніж їхати на об'єкт.
      const matches = findNaryadMatches(text);
      if(matches.length){ showNaryadMatchResultsModal(matches, chosenDate); }
      else{ showNaryadQueue(chosenDate); }
    });
  }});
}
// NEW: результат перевірки збігів одразу після додавання наряду — той самий
// вигляд карток, що й у "Перевірити наряд", з кнопкою переходу в профіль
// абонента для перегляду попередніх заявок.
function showNaryadMatchResultsModal(matches, continueDate){
  const bodyHtml = `
    <div style="font-size:12.5px; color:var(--text-faint); margin-bottom:10px;">Наряд уже додано в чергу. Знайдено схожі заявки — можливо, це той самий абонент:</div>
    <div>${naryadMatchesHtml(matches, escapeHtml)}</div>
    <button type="button" class="btn btn-block" id="naryadMatchContinueBtn" style="margin-top:10px;">➡️ До черги нарядів</button>`;
  openModal('⚠️ Знайдено збіг', bodyHtml, {onClose: ()=> showNaryadQueue(continueDate), onOpen: (rootEl)=>{
    document.getElementById('naryadMatchContinueBtn').addEventListener('click', ()=> showNaryadQueue(continueDate));
    rootEl.addEventListener('click', e=>{
      const btn = e.target.closest('.open-address-btn');
      if(btn) openAddressForTicket(btn.dataset.id);
    });
  }});
}
// NEW: "🔁 Перенести" на нарядi — абонент попросив на інший день, тож
// потрібно швидко перекласти цей самий наряд на нову дату, не видаляючи й
// не створюючи заново.
function showRescheduleNaryadModal(id){
  const n = naryadQueue.find(x=>String(x.id)===String(id));
  if(!n) return;
  const today = formatDate(new Date());
  const curDate = naryadItemDate(n, formatDate);
  const preview = n.text.length>200 ? n.text.slice(0,200)+'…' : n.text;
  const bodyHtml = `
    <div style="font-size:13px; color:var(--text-dim); margin-bottom:10px; white-space:pre-wrap;">${escapeHtml(preview)}</div>
    <div style="font-size:12.5px; color:var(--text-faint); margin-bottom:10px;">Зараз стоїть на: ${escapeHtml(curDate)}</div>
    <div class="row" style="gap:6px;">
      <button type="button" class="btn btn-sm rescheduleNaryadDateBtn" data-date="${today}" style="flex:1;">Сьогодні</button>
      <button type="button" class="btn btn-sm rescheduleNaryadDateBtn" data-date="${shiftDate(today,1)}" style="flex:1;">Завтра</button>
      <button type="button" class="btn btn-sm rescheduleNaryadDateBtn" data-date="${shiftDate(today,7)}" style="flex:1;">+ Тиждень</button>
    </div>
    <div class="field" style="margin-top:10px;">
      <label>Або оберіть дату</label>
      <input type="date" id="rescheduleNaryadDateInput" value="${ddmmyyyyToIso(curDate)}">
    </div>
    <button type="button" class="btn btn-block btn-accent" id="rescheduleNaryadSaveBtn" style="margin-top:12px;">✅ Перенести</button>`;
  openModal('Перенести наряд', bodyHtml, {onClose: ()=> showNaryadQueue(curDate), onOpen: ()=>{
    document.querySelectorAll('.rescheduleNaryadDateBtn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ document.getElementById('rescheduleNaryadDateInput').value = ddmmyyyyToIso(btn.dataset.date); });
    });
    document.getElementById('rescheduleNaryadSaveBtn').addEventListener('click', ()=>{
      const newDate = isoToDdmmyyyy(document.getElementById('rescheduleNaryadDateInput').value);
      if(!newDate){ showToast('Оберіть дату'); return; }
      n.date = newDate;
      saveNaryadQueue();
      updateNaryadQueueBtn();
      showToast('Наряд перенесено на ' + newDate);
      showNaryadQueue(newDate);
    });
  }});
}


function showNaryadChecker(){
  const bodyHtml = `
    <textarea id="naryadInput" placeholder="Встав сюди текст наряду від диспетчера…" style="min-height:90px;"></textarea>
    <button type="button" class="btn btn-block" id="naryadCheckBtn" style="margin-top:8px;">🔎 Перевірити</button>
    <div style="font-size:11.5px; color:var(--text-faint); margin-top:6px;">Збіг за телефоном — надійний. Збіг за адресою — лише підказка: за одним будинком можуть жити різні абоненти.</div>
    <div id="naryadResults" style="margin-top:14px;"></div>
    <div style="font-size:11.5px; color:var(--text-faint); margin:14px 0 6px;">Якщо збігів немає — це нова заявка:</div>
    <div class="row" style="gap:8px;">
      <button type="button" class="btn btn-block" id="naryadNewConnectBtn" style="flex:1;">🔌 Підключення</button>
      <button type="button" class="btn btn-block" id="naryadNewRepairBtn" style="flex:1;">🛠️ Ремонт</button>
    </div>
    <button type="button" class="btn btn-block" id="naryadBackBtn" style="margin-top:8px;">⬅ Назад до пошуку</button>`;
  openModal('Перевірити наряд', bodyHtml, {onClose: renderAddressNav, onOpen: (rootEl)=>{
    const runCheck = ()=>{
      const text = document.getElementById('naryadInput').value.trim();
      const resultsEl = document.getElementById('naryadResults');
      if(!text){ resultsEl.innerHTML = ''; return; }
      resultsEl.innerHTML = naryadMatchesHtml(findNaryadMatches(text), escapeHtml);
    };
    document.getElementById('naryadCheckBtn').addEventListener('click', runCheck);
    rootEl.addEventListener('click', e=>{
      const btn = e.target.closest('.open-address-btn');
      if(btn){ openAddressForTicket(btn.dataset.id); }
    });
    // NEW: створити заявку прямо звідси, не виходячи в загальний список —
    // вставлений текст наряду переносимо в зміст заявки, а якщо в тексті
    // знайшовся номер телефону — підставляємо і його. Тип обирається кнопкою,
    // окремий пікер тут не потрібен, бо диспетчер завжди каже, підключення це
    // чи ремонт.
    const startFromNaryad = type=>{
      const rawText = document.getElementById('naryadInput').value.trim();
      const prefill = {};
      // NEW: те саме виправлення, що й вище — текст наряду в masterNote
      // (приватна примітка "🔒 Тільки для вас", ніколи не летить диспетчеру),
      // а не в note (яке потрапляє в текст заявки для диспетчера) чи в
      // content (перезаписувався і губився).
      if(rawText) prefill.masterNote = rawText;
      const phoneMatch = extractPhoneFromText(rawText);
      if(phoneMatch) prefill.phone = phoneDigitsToMask(phoneMatch);
      startNewTicketFlow(type, prefill, {...addrNavState});
    };
    document.getElementById('naryadNewConnectBtn').addEventListener('click', ()=> startFromNaryad('Підключення'));
    document.getElementById('naryadNewRepairBtn').addEventListener('click', ()=> startFromNaryad('Ремонт'));
    document.getElementById('naryadBackBtn').addEventListener('click', renderAddressNav);
  }});
}

/* ---------- Навігатор адрес: Місто → Вулиця → Будинок → Заявки ---------- */
// NEW: чотирирівневий пошук по факту заявок (а не по довіднику settings.cities/streets,
// щоб туди потрапляло геть усе, включно з тим, що було записано до автопрописки).
// Заявки, відновлені з хмари (cloudImported), потрапляють сюди лише якщо для них
// вручну дозаповнили місто й вулицю (поля city/street/house видно й редагуються
// навіть у "сирому" режимі) — критерій саме заповненість полів, а не сам прапорець.
let addrNavState = {level:'city', city:null, street:null, house:null, apartment:null};
let addrNavSearchQuery = ''; // NEW: глобальний пошук за ім'ям/телефоном/адресою (працює одразу по всіх заявках, не лише в межах вибраного міста/вулиці)
// NEW: якщо заявку відкрили на редагування з профілю абонента (навігатор
// адрес) — запам'ятовуємо, куди повернутись після скасування/збереження,
// замість того, щоб завжди приземлятись на звичайний список "Заявки".
let editReturnAddrState = null;
function pushAddressNavigation(){
  const state={addrNavState:{...addrNavState},query:addrNavSearchQuery,scrollTop:document.getElementById('addrNavResultsArea')?.scrollTop||0};
  appNavigationPush('address-level',saved=>{addrNavState={...saved.addrNavState};addrNavSearchQuery=saved.query||'';renderAddressNav();requestAnimationFrame(()=>{const root=document.getElementById('addrNavResultsArea');if(root)root.scrollTop=Number(saved.scrollTop)||0;});},state);
}
function returnAfterTicketEdit(){
  switchTab('tickets');
  if(editReturnAddrState){
    addrNavState = editReturnAddrState;
    editReturnAddrState = null;
    renderAddressNav();
  }
}

// NEW: маленький пікер типу заявки — використовується і на головній кнопці
// "+ Заявка", і на кнопці створення заявки в профілі абонента, і на кнопці
// створення заявки прямо з екрана пошуку навігатора адрес.
function showTicketTypePicker(onPick, onCancel){
  openModal('Оберіть тип заявки', `
    <div style="display:flex; flex-direction:column; gap:10px;">
      <button type="button" class="btn btn-block ticket-type-pick-btn" data-type="Підключення">🔌 Підключення</button>
      <button type="button" class="btn btn-block ticket-type-pick-btn" data-type="Ремонт">🛠️ Ремонт</button>
      <button type="button" class="btn btn-block ticket-type-pick-btn" data-type="Інше">📋 Інше</button>
    </div>`, {onClose: onCancel || closeModal, onOpen: (rootEl)=>{
    rootEl.querySelectorAll('.ticket-type-pick-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{ closeModal(); onPick(btn.dataset.type); });
    });
  }});
}

// NEW: відкриває порожню форму заявки з уже обраним типом і (за наявності)
// підставленими даними абонента з профілю. Якщо передано returnState —
// запам'ятовуємо, куди повернутись (як і при редагуванні з профілю), і
// показуємо кнопку "Назад" замість "Скасувати редагування", бо це нова
// заявка, а не редагування наявної.
function startNewTicketFlow(type, prefill, returnState, naryadIdToComplete){
  closeModal(); // на випадок, якщо запуск стався з модалки пошуку/профілю
  resetCalcForm(formatDate(new Date()), Object.assign({type}, prefill||{}));
  naryadPendingCompletionId = naryadIdToComplete || null;
  if(returnState){
    editReturnAddrState = {...returnState};
    const cancelBtn = document.getElementById('cancelEditBtn');
    cancelBtn.textContent = '⬅ Назад до пошуку';
    cancelBtn.classList.remove('hidden');
  }
  switchTab('calculator');
}

// NEW: один будинок може мати кілька квартир з РІЗНИМИ абонентами — тому
// "профіль" будується не просто на рівні будинку, а на рівні будинок+квартира.
// Якщо квартира не вказана, всі такі заявки потрапляють в один спільний
// "профіль" (приватний будинок без поділу на квартири).

function openAddressNavigator(){
  addrNavState = {level:'city', city:null, street:null, house:null, apartment:null};
  addrNavSearchQuery = ''; // NEW
  renderAddressNav();
}


// NEW: пошук одразу по всіх заявках за іменем, телефоном (частково, досить
// набрати кілька цифр) або будь-яким словом з адреси — щоб не обов'язково
// пам'ятати точну адресу, а можна було знайти абонента "як завгодно".


// NEW: компактна кнопка-профіль для списків (профілі в будинку, результати
// пошуку) — лише ім'я/телефон/адреса/кількість заявок, тап веде всередину
// до повного профілю з картками. Той самий вигляд в обох місцях.

// NEW: "профіль" абонента — шапка над списком заявок конкретного будинку:
// ім'я + телефон (з найсвіжішої заявки, де вони заповнені) + скільки разів
// тут були. Якщо в різних заявках траплялись РІЗНІ імена/телефони — показуємо
// це окремим попередженням, а не тихо обираємо один варіант, бо за однією
// адресою можуть бути різні люди (сусід, родич тощо).

function renderAddressNav(){
  const title = addrNavTitle();
  const topHtml = `
    ${!toolsMapReturnContext&&appNavigationCanGoBack()?appBackButtonHtml():''}
    <div class="row" style="gap:6px; margin-bottom:10px;">
      <input type="search" role="searchbox" name="mt-internal-profile-search" inputmode="search" id="addrNavSearchInput" placeholder="Пошук за ім'ям, телефоном або адресою" value="${escapeHtml(addrNavSearchQuery)}" style="flex:1;" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
      <button type="button" class="btn btn-icon" id="addrNavClearSearchBtn" title="Очистити пошук">✕</button>
    </div>
    <button type="button" class="btn btn-block" id="openNaryadCheckerBtn" style="margin-bottom:12px;">📋 Перевірити наряд</button>
    <div id="addrNavResultsArea">${addrNavResultsAreaHtml()}</div>`;
  openModal(title, topHtml, {onClose:()=>{appNavigationDropPrefix('address-');appNavigationDrop('map-profile');if(typeof toolsClearMapReturnContext==='function')toolsClearMapReturnContext();closeModal();},onOpen: attachAddressNavHandlers});
}

function attachAddressNavHandlers(rootEl){
  // NEW: пошук — оновлюємо лише результати (не весь модал), щоб не губити фокус/курсор у полі вводу
  const searchInput = document.getElementById('addrNavSearchInput');
  const refreshAddrNavResults = ()=>{
    document.getElementById('addrNavResultsArea').innerHTML = addrNavResultsAreaHtml();
    const titleEl = document.querySelector('.modal-head h3');
    if(titleEl) titleEl.textContent = addrNavTitle();
  };
  if(searchInput){
    searchInput.addEventListener('input', ()=>{
      addrNavSearchQuery = searchInput.value;
      refreshAddrNavResults();
    });
  }
  const clearSearchBtn = document.getElementById('addrNavClearSearchBtn');
  if(clearSearchBtn){
    clearSearchBtn.addEventListener('click', ()=>{
      addrNavSearchQuery = '';
      if(searchInput) searchInput.value = '';
      refreshAddrNavResults();
    });
  }
  const naryadBtn = document.getElementById('openNaryadCheckerBtn');
  if(naryadBtn) naryadBtn.addEventListener('click', showNaryadChecker);

  rootEl.addEventListener('click', e=>{
    const backToMapBtn=e.target.closest('.abonent-back-map-btn');
    if(backToMapBtn&&typeof toolsReturnFromProfileToMap==='function'){toolsReturnFromProfileToMap();return;}
    const crumb = e.target.closest('.addr-nav-crumb');
    if(crumb){
      pushAddressNavigation();
      const to = crumb.dataset.crumb;
      if(to==='city') addrNavState = {level:'city', city:null, street:null, house:null, apartment:null};
      else if(to==='street'){ addrNavState.level='street'; addrNavState.street=null; addrNavState.house=null; addrNavState.apartment=null; }
      else if(to==='house'){ addrNavState.level='house'; addrNavState.house=null; addrNavState.apartment=null; }
      else if(to==='profiles'){ addrNavState.level='profiles'; addrNavState.apartment=null; }
      renderAddressNav(); return;
    }
    const cityBtn = e.target.closest('.addr-nav-city-btn');
    if(cityBtn){ pushAddressNavigation();addrNavState = {level:'street', city:cityBtn.dataset.city, street:null, house:null, apartment:null}; renderAddressNav(); return; }
    const streetBtn = e.target.closest('.addr-nav-street-btn');
    if(streetBtn){pushAddressNavigation();addrNavState.level='house'; addrNavState.street=streetBtn.dataset.street; addrNavState.house=null; addrNavState.apartment=null; renderAddressNav(); return; }
    const houseBtn = e.target.closest('.addr-nav-house-btn');
    if(houseBtn){
      pushAddressNavigation();
      addrNavState.house = houseBtn.dataset.house;
      // NEW: якщо в цьому будинку заявки лише по одній квартирі (чи квартира
      // взагалі не використовується) — одразу показуємо профіль, не змушуючи
      // тапати зайвий раз; якщо квартир кілька — спершу список профілів.
      const groups = getApartmentGroupsForHouse(addrNavState.city, addrNavState.street, addrNavState.house);
      if(groups.size <= 1){
        addrNavState.apartment = groups.size ? [...groups.keys()][0] : '(без кв.)';
        addrNavState.level = 'tickets';
      } else {
        addrNavState.level = 'profiles';
        addrNavState.apartment = null;
      }
      renderAddressNav(); return;
    }
    const profileBtn = e.target.closest('.addr-profile-btn');
    if(profileBtn){
      pushAddressNavigation();
      // NEW: результати пошуку несуть повну адресу в data-*, а кнопки
      // всередині одного будинку (рівень 'profiles') — лише квартиру
      if(profileBtn.dataset.city) addrNavState.city = profileBtn.dataset.city;
      if(profileBtn.dataset.street) addrNavState.street = profileBtn.dataset.street;
      if(profileBtn.dataset.house) addrNavState.house = profileBtn.dataset.house;
      addrNavState.apartment = profileBtn.dataset.apartment;
      addrNavState.level = 'tickets';
      addrNavSearchQuery = '';
      renderAddressNav(); return;
    }
    // NEW: фото абонента підвантажується лише за тапом на кнопку — не сама
    // собою при відкритті профілю, і не зберігається на телефоні окремо від
    // звичайного кешу фото заявок (той самий IndexedDB, що й завжди). Кнопку
    // тепер можна натиснути повторно, щоб знову приховати фото — раніше вона
    // ховалась назавжди після першого показу.
    const photoBtn = e.target.closest('.abonent-photo-btn');
    if(photoBtn){
      const wrap = document.getElementById(photoBtn.dataset.wrapId);
      if(!wrap) return;
      // NEW: галерея фото з УСІХ заявок за адресою (не одне фото) — той самий
      // підхід, що й у toggleTicketCardPhoto: підвантажуємо всі паралельно,
      // кожне у своїй мініатюрі, тап по мініатюрі відкриває на весь екран.
      if(!wrap.classList.contains('hidden')){
        wrap.classList.add('hidden');
        photoBtn.textContent = photoBtn.dataset.origLabel || photoBtn.textContent;
        return;
      }
      if(wrap.dataset.loaded === '1'){
        wrap.classList.remove('hidden');
        photoBtn.textContent = '🔼 Сховати фото';
        return;
      }
      let keys = [], fileIds = [];
      try{ keys = JSON.parse(photoBtn.dataset.photoKeys || '[]'); }catch(err){ keys = []; }
      try{ fileIds = JSON.parse(photoBtn.dataset.tgFileIds || '[]'); }catch(err){ fileIds = []; }
      keys = keys.filter(Boolean);
      if(!keys.length) return;
      photoBtn.dataset.origLabel = photoBtn.textContent;
      photoBtn.disabled = true; photoBtn.textContent = '⏳ Завантаження…';
      Promise.all(keys.map((key, i)=> resolvePhotoAsync(key, fileIds[i] || null))).then(values=>{
        photoBtn.disabled = false;
        const loadedAny = values.some(Boolean);
        if(!loadedAny){ photoBtn.textContent = '📷 Не вдалося завантажити, спробувати ще раз'; return; }
        wrap.innerHTML = values.map((val,i)=> val ? `<img src="${val}" class="tc-photo-thumb" data-full="${val}" alt="фото ${i+1}" style="width:96px; height:96px; object-fit:cover; border-radius:10px; cursor:pointer;">` : '').join('');
        wrap.dataset.loaded = '1';
        wrap.classList.remove('hidden');
        photoBtn.textContent = '🔼 Сховати фото';
      });
      return;
    }
    // NEW: редагування даних абонента (адреса/ПІБ/телефон/логін/пароль/договір)
    // прямо з профілю — застосується одразу до всіх заявок за цією адресою
    const editProfileBtn = e.target.closest('.abonent-edit-btn');
    if(editProfileBtn){
      showEditAbonentProfile(editProfileBtn.dataset.profile);
      return;
    }
    const diagnosticsBtn = e.target.closest('.abonent-diagnostics-btn');
    if(diagnosticsBtn){
      let ids=[];
      try{ids=JSON.parse(diagnosticsBtn.dataset.ids||'[]');}catch(_e){ids=[];}
      closeModal();
      openToolsDiagnosticsFromProfile(ids);
      return;
    }
    // NEW: "➕ Заявка" в профілі — та сама форма створення заявки, але з уже
    // підставленими даними абонента; повертаємось сюди ж після збереження
    const newTicketBtn = e.target.closest('.abonent-new-ticket-btn');
    if(newTicketBtn){
      let prefill = {};
      try{ prefill = JSON.parse(newTicketBtn.dataset.prefill || '{}'); }catch(err){ prefill = {}; }
      showTicketTypePicker(type=> startNewTicketFlow(type, prefill, {...addrNavState}), renderAddressNav);
      return;
    }
    // NEW: редагування геолокації прямо з профілю — не лише "Перейти"
    const geoEditBtn = e.target.closest('.abonent-geo-edit-btn');
    if(geoEditBtn){
      let ids = [];
      try{ ids = JSON.parse(geoEditBtn.dataset.ids || '[]'); }catch(err){ ids = []; }
      openAbonentGeoEditModal(ids, geoEditBtn.dataset.geoLink || '');
      return;
    }
    const mapPointBtn = e.target.closest('.abonent-map-point-btn');
    if(mapPointBtn){
      let ids = [];
      try{ ids = JSON.parse(mapPointBtn.dataset.ids || '[]'); }catch(err){ ids = []; }
      openAbonentMapPointPicker(ids);
      return;
    }
    // NEW: редагування примітки про абонента прямо з профілю — без заходу
    // у повне "Редагувати абонента"
    const noteEditBtn = e.target.closest('.abonent-note-edit-btn');
    if(noteEditBtn){
      let ids = [];
      try{ ids = JSON.parse(noteEditBtn.dataset.ids || '[]'); }catch(err){ ids = []; }
      openAbonentNoteEditModal(ids, noteEditBtn.dataset.note || '');
      return;
    }
    // NEW: "🔍 Повна заявка" — лише перегляд оригінального тексту, без edit-режиму
    const viewFullBtn = e.target.closest('.view-full-ticket-btn');
    if(viewFullBtn){ showFullTicketText(viewFullBtn.dataset.id); return; }
    // NEW: "🗓️ На дату" — перейти в основний список заявок на день, коли
    // саме ця заявка була зроблена (замість гортати вручну по днях)
    const jumpDateBtn = e.target.closest('.jump-to-date-btn');
    if(jumpDateBtn){
      const t = tickets.find(x=>String(x.id)===String(jumpDateBtn.dataset.id));
      if(t){ currentTicketDate = t.date; closeModal(); switchTab('tickets'); renderTicketsScreen(); }
      return;
    }
    // NEW: далі — ті самі дії, що й на звичайних картках заявок у списку
    const editBtn = e.target.closest('.edit-ticket-btn');
    if(editBtn){
      editReturnAddrState = {...addrNavState}; // NEW: щоб після скасування/збереження повернутись саме сюди, а не на головний список
      closeModal(); editTicket(editBtn.dataset.id); return;
    }
    const shareBtn = e.target.closest('.share-ticket-btn');
    if(shareBtn){ shareTicket(shareBtn.dataset.id); return; }
    const tgBtn = e.target.closest('.tg-dispatcher-btn');
    if(tgBtn){ sendTicketToDispatcher(tgBtn.dataset.id); return; }
    const tgOpenBtn = e.target.closest('.tg-open-btn');
    if(tgOpenBtn){ openTicketInTelegram(tgOpenBtn.dataset.id); return; }
    const retryTgBtn = e.target.closest('.retry-tg-btn');
    if(retryTgBtn){ retryTelegramBackup(retryTgBtn.dataset.id); return; }
    const retrySyncBtn = e.target.closest('.retry-sync-btn');
    if(retrySyncBtn){ retrySyncTicket(retrySyncBtn.dataset.id); return; }
    const copyBtn = e.target.closest('.copy-ticket-btn');
    if(copyBtn){ copyTicketCardText(copyBtn.dataset.id); return; }
    const dgBtn = e.target.closest('.contract-ticket-btn');
    if(dgBtn){ showDogovor(dgBtn.dataset.id); return; }
    const gotoProfileBtn = e.target.closest('.goto-profile-btn'); // NEW: для "loose"-заявок без структурованої адреси, показаних тут же
    if(gotoProfileBtn){ goToTicketProfile(gotoProfileBtn.dataset.id); return; }
    const delBtn = e.target.closest('.delete-ticket-btn');
    if(delBtn){ deleteTicket(delBtn.dataset.id); renderAddressNav(); return; }
    const photoBadgeBtn = e.target.closest('.tc-photo-toggle-btn');
    if(photoBadgeBtn){ toggleTicketCardPhoto(photoBadgeBtn, rootEl); return; }
    const photoThumb = e.target.closest('.tc-photo-thumb');
    if(photoThumb){ openTicketPhotoFullscreen(photoThumb.dataset.full); return; }
    const expBtn = e.target.closest('.tc-expand-btn');
    if(expBtn){
      const id = expBtn.dataset.id;
      // NEW: та сама заявка може одночасно бути відрендерена і тут (у модалці),
      // і на екрані "Заявки" позаду — тоді на сторінці двоє елементів з
      // однаковим id. document.getElementById бере ПЕРШИЙ у документі, що міг
      // бути прихованою фоновою карткою — тому шукаємо лише всередині цієї
      // модалки (rootEl), щоб точно розгортати саме те, що бачить користувач.
      const contentEl = rootEl.querySelector('[id="tcc-'+id+'"]');
      if(!contentEl) return;
      const collapsed = contentEl.classList.toggle('tc-collapsed');
      expBtn.textContent = collapsed ? '▼ Розгорнути' : '▲ Згорнути';
    }
  });
}
