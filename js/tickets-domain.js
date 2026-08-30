/* Canonical ticket list, trash, calendar and mutation workflows. */

function ticketsForDate(dateStr){
  return tickets.filter(t=>t.date===dateStr).sort((a,b)=> (a.time||'').localeCompare(b.time||''));
}
// NEW: порядковий номер заявки за день (1, 2, 3...) — рахуємо за хронологією
// (час створення в межах дня), незалежно від того, як зараз відсортований/
// відфільтрований список на екрані (пошук, теги тощо).
function getDailyTicketNumber(t){
  const sameDay = ticketsForDate(t.date); // вже відсортовано за часом зростаючо
  const idx = sameDay.findIndex(x=>String(x.id)===String(t.id));
  return idx>-1 ? idx+1 : null;
}
// NEW: точково перемальовує ОДНУ картку заявки (за id) там, де вона зараз є на
// екрані — без повного renderMainTicketList(), щоб не збивати позицію скролу
// й стан "розгорнуто/згорнуто" інших карток. Картка може одночасно бути в
// декількох місцях (список + модалка адресної навігації) — оновлюємо всі.
function refreshTicketCardDom(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  document.querySelectorAll(`.ticket-card[data-id="${id}"]`).forEach(el=>{
    const workOnly = el.dataset.workonly === '1'; // NEW: не втрачаємо режим "тільки робота" (профіль абонента) при фоновому оновленні
    el.outerHTML = renderTicketCard(t, {workOnly});
  });
}
/* Ключ для сортування заявок за датою+часом (а не за порядком створення) —
   потрібен у пошуку й фільтрі за тегами, де на екрані одразу заявки з
   різних дат: заявка, створена заднім чи майбутнім числом, має ставати на
   своє місце серед дат, а не вилазити нагору лише тому, що її щойно
   створили. */
function renderTicketsScreen(){
  document.getElementById('currentDateDisplay').textContent = currentTicketDate;
  updateNaryadQueueBtn(); // NEW: підпис кнопки залежить від поточної дати — оновлюємо разом з нею
  renderDateNavVisibility();
  renderDaySummary();
  renderMainTicketList();
  renderSyncQueueBanner();
  renderQuickDialButtons();
}

function renderSyncQueueBanner(){
  const banner = document.getElementById('syncQueueBanner');
  if(!getScriptUrl()){ banner.classList.add('hidden'); return; }
  const total = syncEngine ? syncEngine.pendingCount() : 0;
  if(total === 0){ banner.classList.add('hidden'); return; }
  banner.classList.remove('hidden');
  const text = document.getElementById('syncQueueBannerText');
  text.textContent = navigator.onLine
    ? `⏳ Не синхронізовано: ${total} — спробувати ще раз?`
    : `📴 Немає інтернету — ${total} заявок надішлю, коли з'явиться зв'язок`;
}

async function retrySyncQueue(){
  const retryBtn = document.getElementById('syncQueueRetryBtn');
  if(!syncEngine || !getScriptUrl()) return;
  retryBtn.disabled = true;
  let ok=false;
  try{
    ok=await syncEngine.flush();
  } finally {
    retryBtn.disabled = false;
  }
  renderTicketsScreen();
  showToast(ok ? 'Усе синхронізовано ✅' : `Залишилось не синхронізовано: ${syncEngine.pendingCount()}`);
}

function renderMainTicketList(){
  const listEl = document.getElementById('ticketList');
  let list;
  const q = searchQuery.trim().toLowerCase();

  if(q){
    const qDigits = q.replace(/\D/g,''); // NEW: пошук за цифрами телефону — окремо від тексту нижче
    list = tickets.filter(t =>
      (t.content||'').toLowerCase().includes(q) ||
      (t.date||'').includes(q) ||
      (t.tags||[]).some(tag=>tag.toLowerCase().includes(q)) ||
      (t.city||'').toLowerCase().includes(q) ||
      (t.address||'').toLowerCase().includes(q) ||
      (t.clientName||'').toLowerCase().includes(q) ||
      ticketSignalMatchesQuery(t,q) ||
      // NEW: раніше пошук телефону тут не спрацьовував — t.content містить
      // номер УЖЕ ЗІ СКОБКАМИ/ДЕФІСАМИ ("(067)123-45-67"), а простий пошук
      // цифр ("067123") не збігається як підрядок такого форматованого
      // тексту. Порівнюємо цифри з цифрами, як і в навігаторі адрес.
      (qDigits.length>=3 && String(t.phone||'').replace(/\D/g,'').includes(qDigits)) ||
      (qDigits.length>=3 && (t.extraPhones||[]).some(p=>String(p||'').replace(/\D/g,'').includes(qDigits)))
    ).sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
    document.getElementById('modeSummaryText').textContent = `Знайдено: ${list.length} заявок`;
  } else if(activeFilterTags.size>0){
    list = tickets.filter(t => (t.tags||[]).some(tag=>activeFilterTags.has(tag)))
      .sort((a,b)=> ticketSortKey(b) - ticketSortKey(a));
    document.getElementById('modeSummaryText').textContent = `За тегами (${[...activeFilterTags].join(', ')}): ${list.length}`;
  } else {
    list = ticketsForDate(currentTicketDate);
  }

  if(list.length===0){
    renderEmptyTicketList(listEl);
    return;
  }

  // Якщо змінився пошук/фільтр/день — це новий список, скидаємо ліміт показу на 100.
  const signature = q + '|' + [...activeFilterTags].sort().join(',') + '|' + currentTicketDate;
  if(signature !== ticketListRenderSignature){
    ticketListRenderSignature = signature;
    ticketListRenderLimit = TICKET_LIST_PAGE_SIZE;
  }

  const visible = list.slice(0, ticketListRenderLimit);
  let html = visible.map(renderTicketCard).join('');
  if(list.length > visible.length){
    const remaining = list.length - visible.length;
    html += buildShowMoreTicketsButton(remaining);
  }
  listEl.innerHTML = html;
}

// NEW: 📷-бейдж на картці заявки тепер можна натиснути, щоб показати фото
// (підвантажується лише за тапом, як і фото абонента) та натиснути ще раз,
// щоб знову сховати. scopeEl — корінь пошуку елементів (щоб не сплутати з
// однаковим id тієї самої заявки, відрендереної одночасно і в модалці, і
// позаду на екрані).
// NEW: "👤 В профіль" на картці заявки — веде одразу до профілю абонента
// (навігатор адрес, той самий екран, де видно повну історію заявок за цією
// адресою) замість колишньої кнопки "На дату". В профілі кнопки самих
// заявок лишились із "На дату" — там вона й досі корисна.
function goToTicketProfile(id){
  const t = tickets.find(x=>String(x.id)===String(id));
  if(!t) return;
  const city = (t.city||'').trim(), street = (t.street||'').trim();
  if(!city || !street){ showToast('У цієї заявки немає структурованої адреси — профіль зібрати нема з чого'); return; }
  addrNavSearchQuery = '';
  addrNavState = {level:'tickets', city, street, house: (t.house||'').trim() || '(без номера)', apartment: ticketApartmentKey(t)};
  renderAddressNav();
}
function toggleTicketCardPhoto(btn, scopeEl){
  const root = scopeEl || document;
  const id = btn.dataset.id;
  const wrap = root.querySelector('[id="tcp-'+id+'"]');
  if(!wrap) return;
  if(!wrap.classList.contains('hidden')){
    wrap.classList.add('hidden');
    btn.textContent = btn.dataset.origLabel || '📷 Фото';
    return;
  }
  if(wrap.dataset.loaded === '1'){
    wrap.classList.remove('hidden');
    btn.textContent = '🔼 Сховати фото';
    return;
  }
  let keys = [];
  try{ keys = JSON.parse(btn.dataset.photoKeys || '[]'); }catch(err){ keys = []; }
  keys = keys.filter(Boolean);
  if(!keys.length) return;
  // NEW: раніше запасний Telegram file_id (на випадок відсутності локальної
  // копії фото) брався лише для ПЕРШОГО фото (data-tg-file-id, одиничне
  // поле) — для другого й третього завжди null, тож вони не могли
  // відновитись із Telegram. Тепер читаємо масив (data-tg-file-ids) — по
  // одному id на кожне фото, як і в профілі абонента.
  let fileIds = [];
  try{ fileIds = JSON.parse(btn.dataset.tgFileIds || '[]'); }catch(err){ fileIds = []; }
  btn.dataset.origLabel = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ Завантаження…';
  // NEW: до 3 фото на заявку — вантажимо всі паралельно, кожне у своєму
  // мініатюрному блоці (тап по мініатюрі відкриває фото на весь екран)
  Promise.all(keys.map((key, i)=> resolvePhotoAsync(key, fileIds[i] || null))).then(values=>{
    btn.disabled = false;
    const loadedAny = values.some(Boolean);
    if(!loadedAny){ btn.textContent = '📷 Не вдалося завантажити'; return; }
    wrap.innerHTML = values.map((val,i)=> val ? `<img src="${val}" class="tc-photo-thumb" data-full="${val}" alt="фото ${i+1}" style="width:96px; height:96px; object-fit:cover; border-radius:10px; cursor:pointer;">` : '').join('');
    wrap.dataset.loaded = '1';
    wrap.classList.remove('hidden');
    btn.textContent = '🔼 Сховати фото';
  });
}
// NEW: тап по мініатюрі в розгорнутому списку фото заявки — показує це фото
// на весь екран (просте модальне вікно, без зайвих кнопок)
function openTicketPhotoFullscreen(src){
  openModal('Фото', `<img src="${src}" style="width:100%; border-radius:10px;">`, {});
}
function deleteTicket(id){
  if(!confirm('Видалити цю заявку?')) return;
  const idx = tickets.findIndex(x=>String(x.id)===String(id)); // NEW: id заявок з хмари приходить рядком, а не числом
  if(idx===-1) return;
  const t = tickets[idx];
  tickets.splice(idx,1);
  saveTickets();
  // NEW: раніше результат цього запиту ніде не перевірявся — якщо видалення
  // не дійшло до Google Таблиці (немає інтернету саме в цей момент), заявка
  // все одно йшла в кошик, зникала з tickets, і retrySyncQueue (яка шукає
  // лише tickets.filter(t=>!t.synced)) більше НІКОЛИ не намагалась
  // повторити видалення — старий рядок так і лишався в Таблиці назавжди.
  // Тепер, якщо видалення не вдалось одразу, позначаємо запис у кошику
  // прапорцем pendingCloudDelete — retrySyncQueue (і кнопка "Повторити", і
  // подія online) підхоплять його пізніше.
  // NEW: Telegram-бекап НЕ видаляється разом із заявкою навмисно — навіть якщо
  // заявку видалили в застосунку (помилково чи ні), її копія назавжди лишається
  // в групі-архіві. Це і є сенс резервної копії: вона не залежить від дій в
  // основному застосунку. Синхронізується з групою лише редагування (див.
  // backupTicketToTelegram), а видалення — ні.
  // Не видаляємо фото одразу — заявка йде в кошик, фото ще може знадобитись при відновленні.
  // Ставимо прапорець ДО мережі: якщо застосунок закриється під час await,
  // наступний запуск усе одно знатиме, що Google-видалення треба повторити.
  moveTicketToTrash(t);
  renderTicketsScreen();
  showToast('Заявку видалено — відновити можна в Налаштуваннях → Кошик');
}

/* ---- Кошик видалених заявок: зберігає останні DELETED_TICKETS_MAX записів,
   старіші за цю межу видаляються остаточно (разом із фото в IndexedDB). ---- */
// NEW: спільна функція для видалення ВСІХ фото заявки з IndexedDB (масив
// photos, якщо є, інакше старе одиничне поле photo) — використовується і в
// кошику (переповнення/остаточне видалення), і будь-де ще, де потрібно
// прибрати фото заявки цілком. Раніше кошик прибирав лише t.photo (перше
// фото), а друге й третє лишались "сиротами" в IndexedDB назавжди.
function deleteAllTicketPhotos(t){
  const keys = (t.photos && t.photos.length) ? t.photos : (t.photo ? [t.photo] : []);
  keys.forEach(k=> deletePhotoKey(k));
}

function moveTicketToTrash(t){
  const copy = JSON.parse(JSON.stringify(t));
  copy.deletedAt = Date.now();
  deletedTickets.unshift(copy);
  while(deletedTickets.length > DELETED_TICKETS_MAX){
    const dropped = deletedTickets.pop();
    deleteAllTicketPhotos(dropped);
  }
  saveDeletedTickets();
  return copy;
}

function saveDeletedTickets(){
  try{ localStorage.setItem('deletedTickets', JSON.stringify(deletedTickets)); }catch(e){ /* сховище повне — не критично, це лише кошик */ }
}

function restoreDeletedTicket(deletedAt){
  const idx = deletedTickets.findIndex(t=>String(t.deletedAt)===String(deletedAt));
  if(idx===-1) return;
  const t = deletedTickets[idx];
  deletedTickets.splice(idx,1);
  saveDeletedTickets();
  const restored = JSON.parse(JSON.stringify(t));
  delete restored.deletedAt;
  // Tombstone старого ID необоротний: restore завжди є новим create.
  restored.id = MTSyncEngineRuntime.uuid();
  delete restored.synced;
  delete restored.syncAction;
  delete restored.pendingCloudDelete;
  tickets.push(restored);
  saveTickets();
  currentTicketDate = restored.date || currentTicketDate;
  renderTicketsScreen();
  renderDeletedTicketsList();
  showToast('Заявку відновлено');
}

function purgeDeletedTicket(deletedAt){
  const idx = deletedTickets.findIndex(t=>String(t.deletedAt)===String(deletedAt));
  if(idx===-1) return;
  if(!confirm('Видалити заявку з кошика остаточно? Відновити після цього буде неможливо.')) return;
  const t = deletedTickets[idx];
  deleteAllTicketPhotos(t); // NEW: усі фото (photos), не лише перше
  deletedTickets.splice(idx,1);
  saveDeletedTickets();
  renderDeletedTicketsList();
}

function renderDeletedTicketsList(){
  const wrap = document.getElementById('deletedTicketsList');
  if(!wrap) return;
  if(deletedTickets.length===0){
    wrap.innerHTML = `<div style="color:var(--text-faint); font-size:13px;">Кошик порожній</div>`;
    return;
  }
  wrap.innerHTML = deletedTickets.map(t=>{
    const d = new Date(t.deletedAt);
    const sub = [t.clientName, [t.city, t.address].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
    return `<div class="settings-row" style="align-items:flex-start; gap:8px;">
      <div style="min-width:0; flex:1;">
        <div class="sr-title">${escapeHtml(t.date||'')} ${escapeHtml(t.time||'')} — ${escapeHtml(t.type||'')}</div>
        <div style="font-size:12px; color:var(--text-dim); overflow-wrap:anywhere;">${escapeHtml(sub)}${t.sum?(' · '+fmtMoney(t.sum)):''}</div>
        <div style="font-size:11px; color:var(--text-faint);">Видалено: ${formatDate(d)} ${formatTime(d)}</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
        <button type="button" class="btn btn-sm restore-trash-btn" data-deleted-at="${t.deletedAt}">↩️ Відновити</button>
        <button type="button" class="btn btn-icon btn-sm btn-ghost purge-trash-btn" data-deleted-at="${t.deletedAt}">✕</button>
      </div>
    </div>`;
  }).join('');
}

function editTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id)); // NEW
  if(!t) return;
  loadTicketIntoForm(t);
  switchTab('calculator');
}

async function retrySyncTicket(id){
  const t = tickets.find(x=>String(x.id)===String(id)); // NEW
  if(!t) return;
  if(!getScriptUrl()){ showToast('Синхронізація не налаштована'); return; }
  showToast('Повторна спроба надсилання...');
  const ok = await syncEngine.flush();
  renderTicketsScreen();
  showToast(ok ? 'Надіслано' : 'Не вдалося — перевірте інтернет-з’єднання');
}

async function copyTicketCardText(id){
  const t = tickets.find(x=>String(x.id)===String(id)); if(!t) return; // NEW
  try{ await navigator.clipboard.writeText(t.content); showToast('Текст заявки скопійовано'); }
  catch(e){
    const ta = document.createElement('textarea');
    ta.value = t.content; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); showToast('Текст заявки скопійовано'); }
    catch(e2){ showToast('Не вдалося скопіювати текст'); }
    ta.remove();
  }
}

/* ---- "Знайти в Telegram" — відкриває саме повідомлення цієї заявки в групі ----
   Працює за прямим посиланням виду https://t.me/c/<internal_id>/<message_id>,
   де internal_id — це chat_id групи без префіксу "-100" (Telegram так формує
   посилання на приватні супергрупи/канали). Спрацьовує лише для тих, хто вже
   є учасником групи — саме тому доступно тільки вам, а не будь-кому з посиланням. */
/* ---- Календар ---- */
const MONTH_NAMES = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const DOW_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
function renderCalendar(){
  document.getElementById('calMonthLabel').textContent = `${MONTH_NAMES[calendarViewDate.getMonth()]} ${calendarViewDate.getFullYear()}`;
  const grid = document.getElementById('calGrid');
  const year = calendarViewDate.getFullYear(), month = calendarViewDate.getMonth();
  const todayStr = formatDate(new Date());
  grid.innerHTML = buildCalendarGridHtml({year, month, tickets, selectedDate:currentTicketDate, todayStr, formatDateValue:formatDate});
}

/* Календар для екрана «Зміни» — той же принцип, що й у «Заявках»:
   крапка під днем означає, що в цей день була зміна, клік переносить
   на цей день у щоденній навігації, а заголовок показує загальні
   години за цей день (якщо змін кілька — суму). */
