/* =====================================================================
   МАЙСТЕР-ТРЕКЕР — основний скрипт
   Розділи: 0) константи й стан, 1) допоміжні функції, 2) синхронізація,
   3) навігація/модалки, 4) екран «Заявки», 5) екран «Калькулятор»,
   6) екран «Зміни», 7) екран «Налаштування», 8) ініціалізація
   ===================================================================== */

/* ---------- 0. Константи та стан ---------- */
// NEW: показується в Налаштуваннях — щоб одразу бачити, чи підвантажилась
// свіжа версія після деплою, чи браузер ще показує старий кеш. Піднімати
// разом із CACHE_NAME у sw.js при кожному суттєвому оновленні.
const APP_VERSION = 'v64.2 · 2026-08-18';
let settings = loadSettings();
if(ensureCatalogTags()) saveSettings(); // NEW: додає теги для всіх матеріалів/робіт з переліку, якщо їх ще нема
// NEW: раніше тут одразу синхронно читалось з localStorage — тепер справжні
// дані підвантажуються асинхронно з IndexedDB у init() (loadTicketsFromIdb),
// до першого рендеру екрану заявок ще встигає бути порожній масив.
let tickets  = [];
let shifts   = loadJSON('shifts', []);
// Ревізії відрізняють «стан на початку cloud load» від локальних змін,
// зроблених користувачем, поки мережевий запит ще очікує відповідь.
let ticketsRevision = 0;
let shiftsRevision = 0;
let deletedTickets = loadJSON('deletedTickets', []); // "кошик" — останні видалені заявки, можна відновити
let syncEngine = null;
let syncTicketsSnapshot = [];
let syncShiftsSnapshot = JSON.parse(JSON.stringify(shifts));
const DELETED_TICKETS_MAX = 30;
// NEW: черга "сирих" нарядів від диспетчера — вставив текст як є (з Viber
// тощо), поки не перетворив на заявку. Маленькі текстові записи, тож
// localStorage тут цілком доречний (не той випадок, що з tickets).
let naryadQueue = loadJSON('naryadQueue', []);
function saveNaryadQueue(){ localStorage.setItem('naryadQueue', JSON.stringify(naryadQueue)); }

let currentTicketDate = formatDate(new Date()); // 'DD.MM.YYYY'
let currentShiftDate  = formatDate(new Date());
let statsViewDate = new Date(); // місяць, що переглядається в огляді статистики/графіку (не пов'язаний з днем додавання зміни)
let calendarViewDate  = new Date(); // місяць, що показується в календарі заявок
let shiftCalendarViewDate = new Date(); // місяць, що показується в календарі змін
let searchQuery = '';
// Ліміт рендеру списку заявок: без нього innerHTML на тисячах заявок
// підвисає телефон при кожному натисканні клавіші в пошуку.
// Скидається на 100 автоматично, щойно змінюється пошук/фільтр/день (signature).
let ticketListRenderLimit = 100;
let ticketListRenderSignature = '';
const TICKET_LIST_PAGE_SIZE = 100;
let activeFilterTags = new Set();

let calcState = blankCalcState();
let editingTicketId = null;
// Наряд в черзі позначаємо виконаним лише після фактичного збереження заявки,
// а не після самого відкриття її форми.
let naryadPendingCompletionId = null;
// NEW: знімок ключів фото на момент відкриття форми (нової чи існуючої
// заявки) — потрібен, щоб при скасуванні редагування прибрати з IndexedDB
// лише ФОТО, ЗНЯТІ В ЦЬОМУ СЕАНСІ (щойно сфотографовані, ще ніде не
// збережені), а не ті, що вже належать заявці й мають лишитись.
let calcOriginalPhotoKeys = [];
// NEW: лічильник "сеансу форми" — росте щоразу, коли відкривається нова
// порожня форма (resetCalcForm) чи форма редагування (loadTicketIntoForm).
// handlePhotoFile знімає поточне значення ДО того, як піде асинхронний
// storePhoto (запис в IndexedDB) — якщо до моменту, коли запис завершиться,
// користувач встиг скасувати заявку чи відкрити іншу (сеанс змінився), фото
// видаляється з IndexedDB замість того, щоб "прилипнути" до чужої заявки.
let formSessionId = 0;
let feeIsAutoDefault = true; // NEW: поки true — ціну виклику/підключення можна автоматично підставити при зміні типу заявки; false — майстер вже ввів своє значення вручну, чіпати не можна
let tariffIsAutoDefault = true; // те саме, але для поля "Тариф" — щоб автопідставлене за замовчуванням значення не вважалось "незбереженою зміною"
// NEW: чи торкався користувач полів форми руками. Потрібно окремо від
// hasUnsavedChanges(), бо швидке створення заявки з наряду/профілю саме
// собою вже підставляє телефон/зміст — і якщо просто глянути на таку форму
// й піти на іншу вкладку, вона раніше вважалась "чернеткою" й нав'язливо
// пропонувала відновитись при кожному відкритті застосунку, хоча користувач
// нічого сам не вводив.
let formTouchedByUser = false;

// NEW: раніше тут одразу лежало 'Сам' — і воно ніколи не прибиралось при
// виборі реального напарника (бо "Сам" не рендериться як власна фішка,
// яку можна зняти), тож зміна зберігалась як "Сам, Артем" замість просто
// "Артем". Тепер стартуємо з порожнього набору; якщо нічого не обрано —
// нижче (addShift) все одно підставляється рядок "Сам" за замовчуванням.
let coworkerSelection = new Set();

/* ---------- 1. Допоміжні функції ---------- */
/* ---- Заявки зберігаються в IndexedDB, а не в localStorage ----
   Причина (той самий діагноз, що й для фото вище): localStorage має
   жорсткий ліміт (~5-10МБ на весь сайт) і кожне збереження раніше робило
   синхронний JSON.stringify(tickets) прямо в головному потоці — при великій
   базі це і ризик впертись у ліміт, і відчутне "підвисання" при кожному
   збереженні. IndexedDB такого ліміту не має і працює асинхронно, не
   блокуючи інтерфейс. Зберігаємо весь масив одним записом під фіксованим
   ключем (як і фото — по одному значенню на ключ), а не по заявці на запис:
   це найпростіша зміна, що прибирає обидві проблеми, і НЕ вимагає переписувати
   сотні місць у коді, де tickets.find/filter/push використовуються як
   звичайний синхронний масив у пам'яті — вони лишаються без змін. */
function saveShifts(){
  shiftsRevision++;
  const before=syncShiftsSnapshot; const after=JSON.parse(JSON.stringify(shifts));
  const persist=syncEngine ? syncEngine.recordDiff('shift',before,after) : Promise.resolve();
  return persist.then(()=>{syncShiftsSnapshot=after;localStorage.setItem('shifts',JSON.stringify(shifts));});
}
/* ---- Фото зберігаються окремо в IndexedDB, а не в localStorage ----
   Причина: localStorage має жорсткий ліміт (~5-10МБ на весь сайт), і при
   великій кількості заявок із фото (base64-рядки по 30-100КБ кожен) це
   швидко призводить до переповнення та втрати даних або «зависання»
   інтерфейсу через величезний JSON.stringify(tickets) при кожному збереженні.
   IndexedDB не має такого практичного лімııту і не блокує основний потік.
   У об'єкті заявки (t.photo) тепер зберігається не сам base64, а ключ
   виду 'idb:<id>'; сирі дані лежать в IndexedDB під цим ключем.
   photoCache — пам'ятковий кеш уже завантажених фото для синхронного рендеру. */
// NEW: та сама Map, але зі стелею розміру (LRU — найдавніше використане
// прибирається першим). Дані все одно завжди лежать в IndexedDB — це лише
// кеш для швидкого синхронного доступу, тож витіснення нічого не губить.
/* NEW: якщо локальної копії фото немає (видалили, очистили дані сайту, новий
   телефон через 2 роки і т.д.), а в заявці збережено tgPhotoFileId — пробуємо
   дотягнутись до резервної копії в Telegram-групі за цим file_id. Успішний
   результат одразу "лікуємо" назад у локальний IndexedDB під тим самим ключем,
   щоб наступного разу вже не ходити в мережу. */
const DAILY_BACKUP_MAX = 10;
// NEW: викликається раз при старті застосунку — якщо сьогодні ще не було
// автобекапу, робить знімок і кладе його в IndexedDB, старший за 10-й видаляє
function renderDailyBackupList(){
  const wrap = document.getElementById('dailyBackupList');
  if(!wrap) return;
  const index = loadDailyBackupIndex();
  wrap.innerHTML = index.length ? index.map(entry=>{
    const d = new Date(entry.ts);
    return `<div class="settings-row" style="align-items:center;">
      <div><div class="sr-title">${formatDate(d)}</div><div style="font-size:12px; color:var(--text-dim);">Заявок: ${entry.ticketsCount}, змін: ${entry.shiftsCount}</div></div>
      <div class="row" style="gap:6px;">
        <button type="button" class="btn btn-sm daily-backup-download-btn" data-date="${entry.date}" title="Зберегти як файл">💾</button>
        <button type="button" class="btn btn-sm btn-ghost daily-backup-restore-btn" data-date="${entry.date}" title="Відновити з цього дня">♻️</button>
      </div>
    </div>`;
  }).join('') : '<span style="color:var(--text-faint); font-size:13px;">Бекапів ще немає — перший з\'явиться після сьогоднішнього відкриття застосунку</span>';
}
/* ---- Щомісячне нагадування почистити старі файли бекапів у "Завантаженнях" ----
   Застосунок не може сам видаляти файли з "Завантажень" (браузер це навмисно
   забороняє), тож 1-го числа кожного місяця показуємо на весь екран нагадування
   зробити це вручну. Показується один раз за місяць, поки не натиснуть кнопку. */
function maybeShowMonthlyCleanupReminder(){
  const now = new Date();
  if(now.getDate() !== 1) return; // тільки 1-го числа
  const monthKey = localMonthKey(now); // YYYY-MM, локальний час
  if(localStorage.getItem('cleanupReminderMonth') === monthKey) return; // цього місяця вже показували
  showCleanupReminderOverlay(monthKey);
}
function showCleanupReminderOverlay(monthKey){
  const root = document.getElementById('cleanupReminderRoot');
  if(!root) return;
  root.innerHTML = `
    <div id="cleanupReminderOverlay" style="position:fixed; inset:0; z-index:210; background:var(--bg); display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:30px 24px; gap:14px;">
      <div style="font-size:56px;">🧹</div>
      <div style="font-size:20px; font-weight:800;">Перше число — час почистити бекапи!</div>
      <div style="font-size:14.5px; color:var(--text-dim); max-width:380px; line-height:1.5;">
        Кожен день сюди в «Завантаження» на телефоні складається новий файл
        <span style="font-family:var(--mono); font-size:12.5px;">master-tracker-backup-...json</span>.
        Відкрий Файли / Завантаження і видали зайві старі — досить лишити останні кілька.
      </div>
      <button type="button" class="btn btn-accent btn-block" id="cleanupReminderDoneBtn" style="max-width:320px; margin-top:10px;">✅ Гаразд, я почистив(-ла)</button>
      <button type="button" class="btn btn-ghost btn-sm" id="cleanupReminderLaterBtn">Нагадати пізніше сьогодні</button>
    </div>`;
  document.getElementById('cleanupReminderDoneBtn').addEventListener('click', ()=>{
    localStorage.setItem('cleanupReminderMonth', monthKey); // цього місяця більше не показувати
    root.innerHTML = '';
  });
  document.getElementById('cleanupReminderLaterBtn').addEventListener('click', ()=>{
    root.innerHTML = ''; // ховаємо лише на зараз — знову зʼявиться при наступному відкритті сьогодні
  });
}
/* Одноразова міграція: старі заявки, де photo — це сам base64-рядок,
   переносяться в IndexedDB, а в заявці залишається лише короткий ключ.
   Це звільняє localStorage і прибирає причину «зависань» на великих базах. */
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
  root.innerHTML = `
    <div class="modal-overlay" id="modalOverlay">
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
/* ---------- Історія абонента (пошук збігів по телефону/адресі/MAC) ---------- */
// NEW: розбір "сирого" тексту наряду від диспетчера (вільна форма, як у Telegram-групі) —
// щоб перевірити, чи вже була заявка по цьому абоненту/адресі, ще ДО того, як
// створювати нову. Телефон шукаємо жадібно (будь-які довгі числові послідовності
// з пробілами/дефісами) — це найнадійніший сигнал, бо номер зазвичай пишуть
// без помилок. Адресу шукаємо м'яко, простим збігом слів — тексти диспетчерів
// дуже різношерсті ("вул. Шевченка 21", "Майська 85" без міста тощо), тому
// адресний збіг — лише "можливий", ніколи не точний.
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

function closeModal(){ document.getElementById('modalRoot').innerHTML=''; }
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
    <textarea id="addNaryadInput" placeholder="Встав сюди текст наряду від диспетчера…" style="min-height:90px; width:calc(100% + 32px); margin-left:-16px; margin-right:-16px; border-radius:0;">${escapeHtml(editingNaryad ? editingNaryad.text : '')}</textarea>
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
  openModal(isEditing ? 'Редагувати наряд' : 'Новий наряд', bodyHtml, {onClose: ()=> showNaryadQueue(initialDate), onOpen: ()=>{
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
// NEW: редагування ПІБ/телефону/адреси/логіна/пароля/договору просто з
// профілю абонента (навігатор адрес) — застосовується одразу до ВСІХ
// заявок за цією адресою: де було порожньо — додасть, де вже було —
// виправить. Синхронізацію в хмару/Telegram для кожної із заявок при
// цьому НЕ запускаємо (щоб не заспамити Telegram повідомленнями за кожну
// заявку одразу) — вони підхоплять зміну при наступному звичайному
// збереженні.
function showEditAbonentProfile(profileJson){
  let data;
  try{ data = JSON.parse(profileJson); }catch(e){ return; }
  const ids = data.ids || [];
  const bodyHtml = `
    <div class="row" style="gap:10px;">
      <div class="field" style="flex:1;"><label>Місто</label><input type="text" id="abonentEditCity" list="abonentEditCityDatalist" autocomplete="off" value="${escapeHtml(data.city||'')}"><datalist id="abonentEditCityDatalist"></datalist></div>
      <div class="field" style="flex:2;"><label>Вулиця</label><input type="text" id="abonentEditStreet" list="abonentEditStreetDatalist" autocomplete="off" value="${escapeHtml(data.street||'')}"><datalist id="abonentEditStreetDatalist"></datalist></div>
    </div>
    <div class="row" style="gap:10px; margin-top:10px;">
      <div class="field" style="flex:1;"><label>Будинок</label><input type="text" id="abonentEditHouse" value="${escapeHtml(data.house||'')}"></div>
      <div class="field" style="flex:1;"><label>Квартира</label><input type="text" id="abonentEditApartment" value="${escapeHtml(data.apartment||'')}"></div>
    </div>
    <div class="field" style="margin-top:10px;"><label>ПІБ</label><input type="text" id="abonentEditName" value="${escapeHtml(data.clientName||'')}"></div>
    <div class="field" style="margin-top:10px;"><label>Телефон</label><input type="text" id="abonentEditPhone" value="${escapeHtml(data.phone||'')}"></div>
    <div class="field" style="margin-top:10px;">
      <label>Додаткові телефони</label>
      <div id="abonentEditExtraPhonesList"></div>
      <button type="button" class="btn btn-sm" id="abonentEditAddPhoneBtn" style="margin-top:6px;">➕ Додати телефон</button>
    </div>
    <div class="field" style="margin-top:10px;"><label>Примітка (про абонента)</label><textarea id="abonentEditNote" style="min-height:60px;">${escapeHtml(data.note||'')}</textarea></div>
    <div class="field" style="margin-top:10px;"><label>Логін</label><input type="text" id="abonentEditLogin" value="${escapeHtml(data.login||'')}"></div>
    <div class="field" style="margin-top:10px;"><label>Пароль</label><input type="text" id="abonentEditPassword" value="${escapeHtml(data.password||'')}"></div>
    <div class="field" style="margin-top:10px;"><label>№ договору</label><input type="text" id="abonentEditContract" value="${escapeHtml(data.contractNumber||'')}"></div>
    <div style="font-size:11.5px; color:var(--text-faint); margin-top:8px;">Застосується до всіх заявок за цією адресою (${ids.length} шт.) — де вже було заповнено, зміниться; де не було — додасться.</div>
    <button type="button" class="btn btn-block" id="abonentEditSaveBtn" style="margin-top:12px;">Зберегти</button>`;
  openModal('Редагувати абонента', bodyHtml, {onClose: renderAddressNav, onOpen: ()=>{
    // NEW: та сама маска телефону (050)555-55-55, що й у калькуляторі, плюс
    // одразу приводимо вже наявне значення до маски (могло бути внесене
    // раніше у "сирому" вигляді, з таблиці тощо)
    const abonentEditPhoneEl = document.getElementById('abonentEditPhone');
    abonentEditPhoneEl.addEventListener('input', formatPhoneInput);
    formatPhoneInput({target: abonentEditPhoneEl});
    // NEW: додаткові телефони — рядки додаються/видаляються прямо в DOM
    // (без перерендеру всієї модалки, щоб не губити те, що вже надруковано
    // в інших полях); кожен новий рядок одразу отримує ту саму маску.
    const extraPhonesWrap = document.getElementById('abonentEditExtraPhonesList');
    function addAbonentExtraPhoneRow(value){
      const row = document.createElement('div');
      row.className = 'row abonent-extra-phone-row';
      row.style.cssText = 'gap:6px; margin-top:6px;';
      row.innerHTML = `<input type="text" class="abonent-extra-phone-input" value="${escapeHtml(value||'')}" style="flex:1;"><button type="button" class="btn btn-sm btn-danger abonent-extra-phone-remove">✕</button>`;
      extraPhonesWrap.appendChild(row);
      const inp = row.querySelector('.abonent-extra-phone-input');
      inp.addEventListener('input', formatPhoneInput);
      row.querySelector('.abonent-extra-phone-remove').addEventListener('click', ()=> row.remove());
    }
    (data.extraPhones||[]).forEach(p=> addAbonentExtraPhoneRow(p));
    document.getElementById('abonentEditAddPhoneBtn').addEventListener('click', ()=> addAbonentExtraPhoneRow(''));
    // NEW: ті самі підказки міст/вулиць (через <datalist>), що й у формі
    // створення заявки — вулиці підвантажуються окремо для кожного міста
    // і оновлюються при зміні поля "Місто"
    const abonentEditCityEl = document.getElementById('abonentEditCity');
    const abonentEditCityDl = document.getElementById('abonentEditCityDatalist');
    const abonentEditStreetDl = document.getElementById('abonentEditStreetDatalist');
    abonentEditCityDl.innerHTML = (settings.cities||[]).map(c=>`<option value="${escapeHtml(c)}"></option>`).join('');
    const updateAbonentEditStreetDl = city=>{
      const list = (settings.streets && settings.streets[city]) || [];
      abonentEditStreetDl.innerHTML = list.map(s=>`<option value="${escapeHtml(s)}"></option>`).join('');
    };
    updateAbonentEditStreetDl(data.city||'');
    abonentEditCityEl.addEventListener('input', e=> updateAbonentEditStreetDl(e.target.value.trim()));
    document.getElementById('abonentEditSaveBtn').addEventListener('click', ()=>{
      const vals = {
        city: document.getElementById('abonentEditCity').value.trim(),
        street: document.getElementById('abonentEditStreet').value.trim(),
        house: document.getElementById('abonentEditHouse').value.trim(),
        apartment: document.getElementById('abonentEditApartment').value.trim(),
        clientName: document.getElementById('abonentEditName').value.trim(),
        phone: document.getElementById('abonentEditPhone').value.trim(),
        extraPhones: Array.from(document.querySelectorAll('.abonent-extra-phone-input')).map(inp=>inp.value.trim()).filter(Boolean),
        note: document.getElementById('abonentEditNote').value.trim(),
        login: document.getElementById('abonentEditLogin').value.trim(),
        password: document.getElementById('abonentEditPassword').value.trim(),
        contractNumber: document.getElementById('abonentEditContract').value.trim()
      };
      // NEW: адреса застосовується одразу до ВСІХ заявок цього профілю —
      // якщо її справді змінили (а не просто ПІБ/телефон/тощо), попереджаємо,
      // скільки заявок "переїде" на нову адресу, щоб не зробити це випадково
      const addressChanged = vals.city!==(data.city||'') || vals.street!==(data.street||'') || vals.house!==(data.house||'') || vals.apartment!==(data.apartment||'');
      if(addressChanged){
        const sure = confirm(`Адресу змінено — вона застосується до ${ids.length} заявок(и) за старою адресою (вони «переїдуть» на нову). Якщо це насправді інший абонент — краще скасувати й створити нову заявку з новою адресою. Продовжити?`);
        if(!sure) return;
      }
      ids.forEach(id=>{
        const t = tickets.find(x=>String(x.id)===String(id));
        if(t){
          t.city = vals.city; t.street = vals.street; t.house = vals.house; t.apartment = vals.apartment;
          t.address = [[vals.street, vals.house].filter(Boolean).join(' '), vals.apartment ? `кв. ${vals.apartment}` : ''].filter(Boolean).join(', ');
          t.clientName = vals.clientName; t.phone = vals.phone; t.extraPhones = vals.extraPhones; t.abonentNote = vals.note;
          t.login = vals.login; t.password = vals.password; t.contractNumber = vals.contractNumber;
          // NEW: раніше після масової правки профілю текст заявки (t.content)
          // залишався СТАРИМ — диспетчеру при пересиланні/копіюванні летіло
          // старе ім'я/адреса/телефон, хоча в самій заявці все вже виправлено.
          // Для звичайних (не raw) заявок перебудовуємо текст з новими даними.
          if(!t.cloudImported) t.content = buildTicketContent(t, Number(t.sum)||0);
          // Профіль змінює вже наявну заявку, тому повтор має йти update,
          // а не add: сервер оновлює рядок по stable id без delete-вікна.
        }
      });
      saveTickets();
      showToast('Дані абонента оновлено');
      // NEW: якщо адресу виправили — навігатор слідує за заявками на їхню
      // нову адресу, а не лишається дивитись на порожнє місце
      addrNavState = {level:'tickets', city: vals.city, street: vals.street, house: vals.house || '(без номера)', apartment: vals.apartment || '(без кв.)'};
      renderAddressNav();
    });
  }});
}

function renderAddressNav(){
  const title = addrNavTitle();
  const topHtml = `
    <div class="row" style="gap:6px; margin-bottom:10px;">
      <input type="text" id="addrNavSearchInput" placeholder="Пошук за ім'ям, телефоном або адресою" value="${escapeHtml(addrNavSearchQuery)}" style="flex:1;" autocomplete="off">
      <button type="button" class="btn btn-icon" id="addrNavClearSearchBtn" title="Очистити пошук">✕</button>
    </div>
    <button type="button" class="btn btn-block" id="openNaryadCheckerBtn" style="margin-bottom:12px;">📋 Перевірити наряд</button>
    <div id="addrNavResultsArea">${addrNavResultsAreaHtml()}</div>`;
  openModal(title, topHtml, {onOpen: attachAddressNavHandlers});
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
    const crumb = e.target.closest('.addr-nav-crumb');
    if(crumb){
      const to = crumb.dataset.crumb;
      if(to==='city') addrNavState = {level:'city', city:null, street:null, house:null, apartment:null};
      else if(to==='street'){ addrNavState.level='street'; addrNavState.street=null; addrNavState.house=null; addrNavState.apartment=null; }
      else if(to==='house'){ addrNavState.level='house'; addrNavState.house=null; addrNavState.apartment=null; }
      else if(to==='profiles'){ addrNavState.level='profiles'; addrNavState.apartment=null; }
      renderAddressNav(); return;
    }
    const cityBtn = e.target.closest('.addr-nav-city-btn');
    if(cityBtn){ addrNavState = {level:'street', city:cityBtn.dataset.city, street:null, house:null, apartment:null}; renderAddressNav(); return; }
    const streetBtn = e.target.closest('.addr-nav-street-btn');
    if(streetBtn){ addrNavState.level='house'; addrNavState.street=streetBtn.dataset.street; addrNavState.house=null; addrNavState.apartment=null; renderAddressNav(); return; }
    const houseBtn = e.target.closest('.addr-nav-house-btn');
    if(houseBtn){
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

/* ---------- 2. Синхронізація з Google Sheets ----------
   Заявки завжди йдуть на settings.scriptUrl.
   Зміни йдуть на settings.shiftsScriptUrl, якщо він заданий (окрема таблиця/Excel-файл),
   інакше — туди ж, куди й заявки (одна спільна таблиця, як було раніше). */
function getScriptUrl(){ return (settings.scriptUrl || DEFAULT_SCRIPT_URL || '').trim(); }
function getShiftsScriptUrl(){ return (settings.shiftsScriptUrl || getScriptUrl()).trim(); }

function setSyncState(state){
  // state: 'idle' | 'syncing' | 'ok' | 'err'
  const dot = document.getElementById('syncDot');
  dot.className = 'sync-dot' + (state==='idle' ? '' : ' '+state);
  if(state==='ok' || state==='err'){
    setTimeout(()=>{ dot.className='sync-dot'; }, 1800);
  }
}

async function migrateLegacySyncState(){
  const legacyTickets=tickets.filter(t=>t.synced===false);
  const hadLegacyTicketFields=tickets.some(t=>Object.prototype.hasOwnProperty.call(t,'synced')||Object.prototype.hasOwnProperty.call(t,'syncAction'));
  const hadLegacyDeletes=deletedTickets.some(t=>Object.prototype.hasOwnProperty.call(t,'pendingCloudDelete'));
  if(legacyTickets.length) await syncEngine.recordDiff('ticket',[],legacyTickets);
  for(const t of deletedTickets.filter(t=>t.pendingCloudDelete)){
    await syncEngine.persistTransition(state=>syncEngine.core.enqueue(state,{entity:'ticket',id:String(t.id),payload:{},delete:true},MTSyncEngineRuntime.uuid));
  }
  tickets.forEach(t=>{delete t.syncAction;delete t.synced;});
  deletedTickets.forEach(t=>{delete t.pendingCloudDelete;});
  if(hadLegacyTicketFields) await ticketsDbPut(tickets);
  if(hadLegacyDeletes) saveDeletedTickets();
}
function isEntitySynced(entity,id){
  if(!syncEngine) return true;
  const record=syncEngine.state.records[MTSyncEngineCore.key(entity,id)];
  return !record || (!record.head && !record.tail);
}

function ticketToSyncPayload(t){
  // Захист від «зіпсованих» заявок, що могли залишитись у локальному
  // сховищі з давніх тестів: якщо id/date/time не є нормальним рядком
  // (наприклад, лишився об'єкт Date або порожнє значення), підставляємо
  // безпечні значення замість того, щоб відправити сміття в таблицю.
  const safeId = (typeof t.id === 'number' || typeof t.id === 'string') ? String(t.id) : String(Date.now());
  const safeDate = (typeof t.date === 'string' && /^\d{2}\.\d{2}\.\d{4}$/.test(t.date)) ? t.date : formatDate(new Date());
  const safeTime = (typeof t.time === 'string' && /^\d{2}:\d{2}$/.test(t.time)) ? t.time : formatTime(new Date());
  // Геолокація та приватна примітка майстра НЕ входять у t.content (щоб не
  // потрапляти диспетчеру при копіюванні/шерингу), але для повного бекапу в
  // таблиці зберігаємо їх окремо — у службовому стовпці, який більше ніде в
  // застосунку не використовується і не завантажується назад автоматично.
  const backupExtra = [];
  if(t.geoLink) backupExtra.push(`Геолокація: ${t.geoLink}`);
  if(t.masterNote) backupExtra.push(`Приватна примітка майстра: ${t.masterNote}`);
  if(t.login) backupExtra.push(`Логін: ${t.login}`);
  if(t.password) backupExtra.push(`Пароль: ${t.password}`);
  // NEW: "Завантажити дані з хмари" раніше замінювала заявки лише на
  // id/date/time/content/sum/tags — місто/вулиця/будинок/квартира/ПІБ/
  // телефон/MAC/обладнання/оплата губились назавжди, хоча текст (content)
  // виглядав повним. Кладемо ці поля в окреме поле payload'а (не в
  // backupNote — щоб не роздувати той самий текстовий стовпець) — на боці
  // Apps Script воно йде в окремий стовпець "повніДаніJSON" (див. оновлений
  // скрипт), а при завантаженні з хмари відновлюємо їх назад.
  const fullData = {
    type:t.type, city:t.city, street:t.street, house:t.house, apartment:t.apartment,
    address:t.address, clientName:t.clientName, phone:t.phone, macAddress:t.macAddress,
    payment:t.payment, cashAmount:t.cashAmount, cardAmount:t.cardAmount, itemPayments:t.itemPayments, callFee:t.callFee, tariff:t.tariff, contractNumber:t.contractNumber,
    equipment:t.equipment, cables:t.cables, presetWorks:t.presetWorks, additionalWork:t.additionalWork,
    note:t.note, otherNote:t.otherNote, abonentNote:t.abonentNote, extraPhones:t.extraPhones // NEW: щоб примітка й додаткові телефони теж відновлювались при завантаженні з хмари
  };
  return {id:safeId, date:safeDate, time:safeTime, content:t.content, sum:t.sum, tags:t.tags||[], backupNote: backupExtra.join('\n'), fullDataJson: JSON.stringify(fullData)};
}
function shiftToSyncPayload(s){
  return {id:s.id, date:s.date, hours:s.hours, coworker:s.coworker};
}

async function loadFromCloud(){
  showToast('Повне відновлення з хмари вимкнено до окремого recovery protocol'); return;
  const ticketsUrl = getScriptUrl();
  const shiftsUrl = getShiftsScriptUrl();
  if(!ticketsUrl && !shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script у налаштуваннях'); return; }
  if(!confirm('Завантажити дані з хмари? Це замінить локальні заявки та/або зміни.')) return;
  const loadTicketsRevision = ticketsRevision;
  const loadShiftsRevision = shiftsRevision;
  setSyncState('syncing');
  let nextTickets = null;
  let nextShifts = null;
  const loadErrors = [];
  // NEW: у хмарі немає полів photo/tg* (там лише текст, суми, теги) — раніше
  // після "Завантажити з хмари" ці посилання просто стирались навіть якщо
  // фото фізично й досі лежить в IndexedDB, а повідомлення — в Telegram-групі.
  // Зберігаємо їх заздалегідь за id, щоб повернути в об'єднані заявки нижче.
  const localPhotoAndTgById = new Map();
  tickets.forEach(t=>{
    // NEW: раніше зберігали лише ОДНЕ фото (t.photo) і одинарні tg-поля —
    // для заявок із 2-3 фото (masiv photos/tgPhotoFileIds/tgPhotoMsgIds)
    // друге й третє фото після "Завантажити з хмари" тихо відв'язувались
    // від заявки (лишались в IndexedDB сиротами, але заявка про них більше
    // "не знала" — картка показувала тільки перше фото).
    if(t.photo || (t.photos && t.photos.length) || t.tgBackedUp || t.tgPhotoFileId || (t.tgPhotoFileIds && t.tgPhotoFileIds.length)){
      localPhotoAndTgById.set(String(t.id), {
        photo: t.photo,
        photos: t.photos ? t.photos.slice() : undefined,
        tgBackedUp: t.tgBackedUp,
        tgPhotoFileId: t.tgPhotoFileId,
        tgPhotoFileIds: t.tgPhotoFileIds ? t.tgPhotoFileIds.slice() : undefined,
        tgSepMsgId: t.tgSepMsgId, tgTextMsgId: t.tgTextMsgId,
        tgPhotoMsgId: t.tgPhotoMsgId,
        tgPhotoMsgIds: t.tgPhotoMsgIds ? t.tgPhotoMsgIds.slice() : undefined,
        tgJsonMsgId: t.tgJsonMsgId
      });
    }
  });
  if(ticketsUrl){
    try{
      throw new Error('ADMIN_RECOVERY_REQUIRED');
      const data = await res.json();
      // NEW: КРИТИЧНО — раніше тут не перевірялась відповідь сервера взагалі.
      // Якщо секретний ключ невірний (наприклад, друкарська помилка чи
      // застарілий), справжній Apps Script повертає {status:'error',
      // message:'forbidden'} — БЕЗ поля tickets. Код же читав
      // (data.tickets||[]) — за відсутності поля це ставало ПОРОЖНІМ
      // масивом, і рядком нижче (saveTickets()) ЛОКАЛЬНА БАЗА ЗАЯВОК
      // ЗАМІНЯЛАСЬ НА ПОРОЖНЮ. Тобто неправильний секрет міг стерти всі
      // заявки на телефоні одним натисканням "Завантажити з хмари".
      if(data.status === 'error' || !Array.isArray(data.tickets)){
        throw new Error(data.message || 'Сервер не повернув список заявок (перевірте секретний ключ)');
      }
      nextTickets = data.tickets.map(t=>{
        const blank = blankTicketObject();
        const extra = parseBackupNote(t.backupNote); // NEW: дістаємо геолокацію/примітку майстра (і, для старих рядків, повні дані, якщо вони туди ще потрапляли)
        // NEW: новий, чистіший шлях — окремий стовпець "повніДаніJSON" у
        // таблиці (не роздуває нотатки_майстра). Для рядків, які встигли
        // синхронізуватись ДО оновлення Apps Script, підстраховуємось старим
        // способом (parseBackupNote вище).
        let fullData = extra.fullData;
        if(t.fullDataJson){
          try{ fullData = JSON.parse(t.fullDataJson); }
          catch(e){ /* пошкоджений JSON у цьому стовпці — лишаємо те, що вже дістали з backupNote (може бути null) */ }
        }
        const merged = Object.assign(blank, {
          id: t.id, date: t.date, time: t.time, content: t.content,
          sum: Number(t.sum)||0,
          tags: Array.isArray(t.tags) ? t.tags : String(t.tags||'').split(',').map(s=>s.trim()).filter(Boolean),
          photo: null,
          geoLink: extra.geoLink,       // NEW
          masterNote: extra.masterNote, // NEW
          login: extra.login,           // NEW
          password: extra.password,     // NEW
          // NEW: якщо є повні структуровані дані (заявки, збережені після
          // цього оновлення) — відновлюємо адресу/MAC/обладнання/оплату один
          // в один, і сирий режим редагування більше не потрібен. Старі
          // заявки без цих даних відновлюються як і раніше — лише за текстом.
          cloudImported: !fullData
        });
        if(fullData) Object.assign(merged, fullData);
        // NEW: якщо для цього id є збережені локальні photo/tg* — повертаємо їх
        const local = localPhotoAndTgById.get(String(merged.id));
        if(local){
          Object.assign(merged, local);
          // NEW: Object.assign копіює й undefined-значення (якщо в local не
          // було масиву photos — властивість все одно перезаписується на
          // undefined) — тож після злиття завжди узгоджуємо одне з одним,
          // а не покладаємось, що обидва поля прийшли синхронізованими.
          if((!merged.photos || !merged.photos.length) && merged.photo) merged.photos = [merged.photo];
          if(merged.photos && merged.photos.length && !merged.photo) merged.photo = merged.photos[0];
          if(!merged.tgPhotoFileIds || !merged.tgPhotoFileIds.length){ merged.tgPhotoFileIds = merged.tgPhotoFileId ? [merged.tgPhotoFileId] : []; }
          if(!merged.tgPhotoMsgIds || !merged.tgPhotoMsgIds.length){ merged.tgPhotoMsgIds = merged.tgPhotoMsgId ? [merged.tgPhotoMsgId] : []; }
        }
        return merged;
      });
    }catch(err){ console.error(err); loadErrors.push(`заявки${err.message ? `: ${err.message}` : ''}`); }
  } else {
    loadErrors.push('заявки: не налаштовано URL');
  }
  if(shiftsUrl){
    try{
      throw new Error('ADMIN_RECOVERY_REQUIRED');
      const data = await res.json();
      // NEW: та сама критична перевірка, що й для заявок вище — без неї
      // невірний секрет так само стирав би локальні "Зміни".
      if(data.status === 'error' || !Array.isArray(data.shifts)){
        throw new Error(data.message || 'Сервер не повернув список змін (перевірте секретний ключ)');
      }
      nextShifts = data.shifts.map(s=>({id:s.id, date:isoToDdmmyyyy(s.date), hours:Number(s.hours)||0, coworker:s.coworker||'Сам'}));
    }catch(err){ console.error(err); loadErrors.push(`зміни${err.message ? `: ${err.message}` : ''}`); }
  } else {
    loadErrors.push('зміни: не налаштовано URL');
  }
  if(loadErrors.length === 0){
    // Атомарність tickets+shifts не захищає від нової локальної роботи під
    // час await fetch. Не зливаємо два незалежні стани автоматично: краще
    // лишити локальні дані й попросити користувача повторити завантаження.
    if(ticketsRevision !== loadTicketsRevision || shiftsRevision !== loadShiftsRevision){
      renderTicketsScreen(); renderShiftsScreen();
      setSyncState('err');
      showToast('Локальні дані змінилися під час завантаження. Дані з хмари не застосовано — повторіть завантаження.');
      return;
    }
    tickets = nextTickets;
    shifts = nextShifts;
    saveTickets();
    saveShifts();
    renderTicketsScreen(); renderShiftsScreen();
    setSyncState('ok');
    showToast(`Завантажено: ${tickets.length} заявок, ${shifts.length} змін`);
  } else {
    renderTicketsScreen(); renderShiftsScreen();
    setSyncState('err');
    showToast(`Не вдалося завантажити дані з хмари: ${loadErrors.join('; ')}. Локальні дані НЕ змінено.`);
  }
}

function backupLocalData(){
  if(typeof maybeRunDailyBackup === 'function') void maybeRunDailyBackup();
}

function restoreFromBackup(){
  showToast('Відновлення доступне у списку щоденних бекапів нижче');
  document.getElementById('dailyBackupList')?.scrollIntoView({behavior:'smooth',block:'center'});
}

async function sendAllToCloud(){
  showToast('Повна синхронізація вимкнена до окремого recovery protocol'); return;
  backupLocalData();
  // "Відправити все" повністю замінює лист "Заявки" на сервері. Порожня
  // локальна база не є командою очистити Google Sheets: для навмисного
  // очищення існує окремий сценарій clearAll з двома підтвердженнями.
  if(tickets.length === 0){
    showToast('Локальних заявок немає. Масова відправка в Google скасована, щоб випадково не очистити хмарні дані. Для навмисного очищення використовуйте окрему функцію очищення.');
    return;
  }
  const ticketsUrl = getScriptUrl();
  const shiftsUrl = getShiftsScriptUrl();
  if(!ticketsUrl && !shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script у налаштуваннях'); return; }
  if(ticketsUrl){
    const ok = await syncEngine.flush();
    // NEW: раніше після масової відправки статус synced НІЯК не оновлювався —
    // локально всі заявки назавжди лишались "не синхронізовано", хоча дані вже
    // потрапили в таблицю. Це не створювало дублів (Apps Script сам відкидає
    // повтори за id), але зайво ганяло мережу при кожному retry і показувало
    // невірний банер "є несинхронізовані".
    if(ok) renderTicketsScreen();
  }
  if(shiftsUrl){
    // Скрипт змін користувача приймає лише по одній зміні через GET (без
    // масової синхронізації) — емулюємо "відправити все" послідовними
    // запитами додавання; дублікати за ID скрипт сам відфільтрує.
    await syncEngine.flush();
  }
  showToast('Дані надіслано до хмари');
}

/* Окремі функції — працюють ТІЛЬКИ зі змінами, не торкаючись заявок.
   На відміну від loadFromCloud()/sendAllToCloud(), тут URL заявок ігнорується
   навіть якщо "URL Apps Script для змін" не заповнений — це явні кнопки
   саме для блоку "Синхронізація — Зміни", щоб не плутати користувача. */
async function loadShiftsFromCloud(){
  showToast('Повне відновлення змін вимкнено до окремого recovery protocol'); return;
  const shiftsUrl = settings.shiftsScriptUrl ? settings.shiftsScriptUrl.trim() : '';
  if(!shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script для змін'); return; }
  if(!confirm('Завантажити зміни з хмари? Поточні локальні зміни буде замінено.')) return;
  setSyncState('syncing');
  try{
    throw new Error('ADMIN_RECOVERY_REQUIRED');
    const data = await res.json();
    if(data.status === 'error' || !Array.isArray(data.shifts)) throw new Error(data.message || 'Сервер не повернув список змін (перевірте секретний ключ)');
    backupLocalData();
    shifts = data.shifts.map(s=>({id:s.id, date:isoToDdmmyyyy(s.date), hours:Number(s.hours)||0, coworker:s.coworker||'Сам'}));
    saveShifts();
    renderShiftsScreen();
    setSyncState('ok');
    showToast(`Завантажено: ${shifts.length} змін`);
  }catch(err){
    console.error(err); setSyncState('err');
    showToast('Не вдалося завантажити зміни з хмари — перевірте, що скрипт підтримує ?action=list');
  }
}
/* Дата з таблиці може прийти як ДД.ММ.РРРР (рядок зі скрипта) — вона вже
   в потрібному форматі, але про всяк випадок підтримуємо й конвертацію,
   якщо колись формат зміниться на РРРР-ММ-ДД. */
async function sendShiftsToCloud(){
  showToast('Повна синхронізація змін вимкнена до окремого recovery protocol'); return;
  const shiftsUrl = settings.shiftsScriptUrl ? settings.shiftsScriptUrl.trim() : '';
  if(!shiftsUrl){ showToast('Спочатку вкажіть URL Apps Script для змін'); return; }
  showToast(`Надсилання ${shifts.length} змін...`);
  await syncEngine.flush();
  showToast('Зміни надіслано до хмари (дублікати за ID пропущені автоматично)');
}

/* ---------- 3. Навігація між вкладками ---------- */
const SCREEN_TITLES = {tickets:'Заявки', calculator:'Калькулятор', shifts:'Зміни', settings:'Налаштування'};
function switchTab(tab){
  // NEW: якщо вкладка вже й так активна — не скидаємо скрол. Це прибирає
  // ефект "улетів на початок форми", який траплявся, якщо щось під час
  // заповнення заявки повторно викликало перемикання на ту саму вкладку.
  const alreadyActive = document.getElementById('screen-'+tab).classList.contains('active');
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.getElementById('screen-'+tab).classList.add('active');
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.getElementById('screenTitle').textContent = SCREEN_TITLES[tab];
  // "Дані" в Налаштуваннях рендеряться один раз при старті застосунку — але
  // кошик змінюється протягом сесії (заявки видаляються з інших екранів),
  // тож оновлюємо саме його щоразу при відкритті вкладки.
  if(tab==='settings') renderDeletedTicketsList();
  if(!alreadyActive) document.querySelector('main.screens').scrollTop = 0;
}

/* ---------- 4. Екран «Заявки» ---------- */
/* NEW: розбирає службовий стовпець "нотатки_майстра" (backupNote), який
   повертає таблиця для кожної заявки, і дістає з нього геолокацію та
   приватну примітку майстра — щоб відновити їх при завантаженні з хмари. */
/* ---------- 5. Екран «Калькулятор» ---------- */
/* Перевіряє, чи в калькуляторі є введені дані, які ще не збережені як заявка.
   Використовується, щоб попередити про втрату даних при перемиканні вкладки
   або закритті застосунку — щоб незбережена заявка не «загубилась» випадково. */
/* ---------- 6. Екран «Зміни» ---------- */
/* ---------- 7. Екран «Налаштування» ---------- */
/* ---- Експорт для NotebookLM ---- */
/* ---- Код Apps Script (для довідки користувачу) ---- */

/* ---------- 8. Прив'язка подій та ініціалізація ---------- */
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

async function sha256Hex(text){
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// NEW: чекає розблокування (якщо захист увімкнено) перш ніж застосунок
// продовжить ініціалізацію — жодні дані абонентів не підвантажуються і не
// малюються до успішного вводу пароля/відбитка.
async function registerBiometricCredential(){
  if(!window.PublicKeyCredential){ showToast('Цей браузер не підтримує вхід за відбитком'); return false; }
  try{
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: {name: 'Майстер-Трекер'},
        user: {id: crypto.getRandomValues(new Uint8Array(16)), name: 'maister', displayName: 'Майстер-Трекер'},
        pubKeyCredParams: [{alg:-7, type:'public-key'}, {alg:-257, type:'public-key'}],
        authenticatorSelection: {authenticatorAttachment:'platform', userVerification:'required'},
        timeout: 30000
      }
    });
    if(!cred) return false;
    settings.appLockCredentialId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    saveSettings();
    return true;
  }catch(err){
    console.error('WebAuthn registration failed:', err);
    showToast('Не вдалося налаштувати відбиток — спробуйте ще раз або лишіть лише пароль');
    return false;
  }
}


async function init(){
  // NEW: тема (data-theme) визначає ВСІ кольорові CSS-змінні (--bg, --text,
  // --accent тощо) — вони не мають запасного значення без цього атрибута.
  // Якщо застосувати тему ПІСЛЯ показу екрана блокування, сам цей екран
  // лишається без кольорів (прозорий фон, змішується зі статичною
  // розміткою під ним) — саме це й сталось на скріншоті. Тема суто
  // косметична і не показує жодних чутливих даних, тож застосовувати її
  // до розблокування абсолютно безпечно.
  applyTheme();
  await ensureAppUnlocked(); // якщо ввімкнено захист входу — чекаємо пароль/відбиток, перш ніж щось малювати чи підвантажувати
  bindTabBar();
  bindTicketsScreen();
  bindCalculatorScreen();
  bindShiftsScreen();
  bindSettingsScreen();

  ticketsDb = await openTicketsDb();
  await loadTicketsFromIdb(); // NEW: підвантажує заявки з IndexedDB (з одноразовою міграцією зі старого localStorage, якщо потрібно) — має відбутись ДО міграції фото нижче, бо та проходиться по tickets
  syncTicketsSnapshot = JSON.parse(JSON.stringify(tickets));
  syncShiftsSnapshot = JSON.parse(JSON.stringify(shifts));
  const syncTransport = MTSyncTransport.create({
    fetch: window.fetch.bind(window),
    url: ()=>getScriptUrl(),
    secret: ()=>String(settings.syncHmacSecret||''),
    responseMode: ()=>settings.syncResponseMode==='readable'?'readable':'opaque',
    random: ()=>MTSyncEngineRuntime.uuid(),
    now: ()=>Date.now(),
    verifyTimeoutMs:1000
  });
  syncEngine = await new MTSyncEngineRuntime.Engine({
    transport:syncTransport,
    online:()=>navigator.onLine && !!getScriptUrl() && String(settings.syncHmacSecret||'').length>=32,
    onChange:()=>{ if(document.getElementById('syncQueueBanner')) renderSyncQueueBanner(); }
  }).init();
  await migrateLegacySyncState();

  photoDb = await openPhotoDb();
  await migrateLegacyPhotosToIdb(); // переносить старі base64-фото з localStorage в IndexedDB (одноразово)

  backupDb = await openBackupDb();
  await maybeRunDailyBackup(); // NEW: раз на день — автоматичний знімок заявок/змін у IndexedDB (10 останніх днів по колу)

  renderTicketsScreen();
  resetCalcForm(currentTicketDate);
  renderShiftsScreen();
  renderSettingsScreen();

  restoreDraftIfAny();
  setInterval(saveDraftToLocalStorage, 30000);

  maybeShowMonthlyCleanupReminder(); // NEW: 1-го числа кожного місяця — нагадування почистити файли бекапів
  maybeSendMonthlyTelegramReport(); // NEW: 1-го числа кожного місяця — авто-звіт у Telegram собі особисто

  document.getElementById('syncQueueRetryBtn').addEventListener('click', retrySyncQueue);
  window.addEventListener('online', ()=>{
    showToast('Інтернет з\'явився — синхронізую...');
    syncEngine.flush();
  });
  window.addEventListener('offline', renderSyncQueueBanner);
}

document.addEventListener('DOMContentLoaded', init);

/* Реєстрація Service Worker — кешує застосунок у браузері, щоб він
   відкривався і без інтернету. Синхронізація зі скриптом Google
   при цьому все одно вимагає мережі — це стосується лише завантаження
   самого інтерфейсу. */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(err=>console.error('SW registration failed', err));
  });
}

/* Попередження при закритті вкладки/застосунку, якщо в калькуляторі є
   незбережені дані. Працює лише в звичайному браузері (Chrome тощо) —
   у PWA-режимі або деяких мобільних webview це попередження може не
   показуватись через обмеження платформи, але шкоди від нього немає. */
window.addEventListener('beforeunload', (e)=>{
  // NEW: та сама причина, що й у bindTabBar вище — прибрано editingTicketId===null,
  // яке раніше вимикало це попередження для редагування вже існуючої заявки.
  syncFormToState();
  if(hasUnsavedChanges()){
    e.preventDefault();
    e.returnValue = '';
  }
});
